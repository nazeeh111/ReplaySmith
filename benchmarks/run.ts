import { createServer } from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { chromium, type Locator, type Page } from 'playwright';
import { demoHtml, demoWorkflow } from '../dist/demo.js';
import { runOnPage } from '../dist/runner.js';
import type { RunResult, StepResult, Target, Workflow } from '../src/types.js';

export const cases = [
  { variant: 'original', group: 'control', expectation: 'complete' },
  { variant: 'id-drift', group: 'recoverable', expectation: 'complete' },
  { variant: 'wrapper-drift', group: 'recoverable', expectation: 'complete' },
  { variant: 'wording-extension', group: 'recoverable', expectation: 'complete' },
  { variant: 'reused-id', group: 'recoverable', expectation: 'complete' },
  { variant: 'delayed', group: 'recoverable', expectation: 'complete' },
  { variant: 'renamed', group: 'unsupported-meaning', expectation: 'abstain' },
  { variant: 'ambiguous', group: 'unsafe-target', expectation: 'abstain' },
  { variant: 'missing', group: 'unsafe-target', expectation: 'abstain' },
  { variant: 'disabled', group: 'unsafe-target', expectation: 'abstain' },
  { variant: 'wrong-outcome', group: 'outcome-failure', expectation: 'fail' },
] as const;
export type Policy = 'selector' | 'semantic' | 'heuristic' | 'recovery';
const policies: Policy[] = ['selector', 'semantic', 'heuristic', 'recovery'];
interface FixtureState { saved: string | null; wrongActions: number; saveCount: number }
export interface Trial {
  policy: Policy;
  variant: string;
  group: string;
  expectation: string;
  iteration: number;
  durationMs: number;
  taskCompleted: boolean;
  verifiedCompletion: boolean;
  safeAbstention: boolean;
  safeStop: boolean;
  state: FixtureState;
  result: RunResult;
}

/** Isolate mutations: preserve the note field except in the ID-drift case. */
export function benchmarkHtml(variant: string): string {
  const sourceVariant = ['id-drift', 'wrapper-drift', 'wording-extension'].includes(variant) ? 'drift' : variant;
  let html = demoHtml(sourceVariant);
  if (variant !== 'id-drift') html = html.replaceAll('message-v2', 'note');
  if (variant === 'ambiguous') html = html.replace('data-operation="save"', 'data-operation="delete"');
  if (variant === 'wrapper-drift') html = html.replace('<div id="actions">', '<div id="actions"><div class="new-shell"><span class="toolbar-label">Draft actions</span>').replace('</button></div></section>', '</button></div></div></section>');
  if (variant === 'wording-extension') html = html.replace('>Save draft</button>', '>Save draft now</button>');
  return html;
}

function semanticLocator(page: Page, target: Target): Locator {
  const e = target.evidence;
  if (e.role && e.name) return page.getByRole(e.role as Parameters<Page['getByRole']>[0], { name: e.name, exact: true });
  if (e.label) return page.getByLabel(e.label, { exact: true });
  if (e.testId) return page.getByTestId(e.testId);
  if (e.placeholder) return page.getByPlaceholder(e.placeholder, { exact: true });
  if (e.text) return page.getByText(e.text, { exact: true });
  throw new Error('No semantic locator in fixture');
}

/**
 * Independent baselines deliberately do not import the recovery score or resolver.
 * They run only against disposable instrumented local fixtures.
 */
export async function runBaseline(page: Page, workflow: Workflow, policy: Exclude<Policy, 'recovery'>, note: string, timeoutMs: number): Promise<RunResult> {
  const started = performance.now();
  const steps: StepResult[] = [];
  const interpolate = (text: string) => text.replaceAll('{{note}}', note);
  page.setDefaultTimeout(timeoutMs);
  const choose = async (target: Target, action: string): Promise<Locator> => {
    if (policy === 'selector') return page.locator(target.selectors[0]);
    if (policy === 'semantic') return semanticLocator(page, target);
    // Simple heuristic: use an existing selector, then exact semantic match,
    // then the first visible same-tag control sharing any name/text token.
    const deadline = performance.now() + timeoutMs;
    do {
      for (const selector of target.selectors) {
        const locator = page.locator(selector);
        if (await locator.count() === 1 && await locator.isVisible()) return locator;
      }
      const exact = semanticLocator(page, target);
      if (await exact.count() === 1 && await exact.isVisible()) return exact;
      const tag = target.evidence.tag ?? (action === 'fill' ? 'input,textarea' : 'button,a');
      const all = page.locator(tag);
      const expected = new Set((target.evidence.name ?? target.evidence.text ?? '').toLowerCase().split(/\W+/).filter(Boolean));
      for (let index = 0; index < await all.count(); index++) {
        const candidate = all.nth(index);
        const text = (await candidate.textContent() ?? '').toLowerCase().split(/\W+/);
        if (await candidate.isVisible() && text.some(word => expected.has(word))) return candidate;
      }
      await new Promise(resolve => setTimeout(resolve, 25));
    } while (performance.now() < deadline);
    throw new Error('No heuristic match');
  };
  for (const step of workflow.steps) {
    const stepStarted = performance.now();
    try {
      if (step.action === 'navigate') await page.goto(step.url!, { waitUntil: 'domcontentloaded', timeout: timeoutMs });
      else if (step.action === 'fill') await (await choose(step.target!, 'fill')).fill(interpolate(step.value!), { timeout: timeoutMs });
      else if (step.action === 'click') await (await choose(step.target!, 'click')).click({ timeout: timeoutMs });
      else if (step.action === 'assert') {
        const target = step.assertion!.target!;
        const locator = policy === 'selector' ? page.locator(target.selectors[0]) : semanticLocator(page, target);
        const deadline = performance.now() + timeoutMs;
        const expected = interpolate(step.assertion!.value!);
        let matched = false;
        do {
          if (await locator.count() === 1 && await locator.isVisible() && (await locator.innerText()).replace(/\s+/g, ' ').trim() === expected) { matched = true; break; }
          await new Promise(resolve => setTimeout(resolve, 25));
        } while (performance.now() < deadline);
        if (!matched) throw new Error('Outcome mismatch');
      } else throw new Error('Unsupported benchmark action');
      steps.push({ id: step.id, action: step.action, status: 'passed', durationMs: performance.now() - stepStarted });
    } catch {
      steps.push({ id: step.id, action: step.action, status: 'failed', durationMs: performance.now() - stepStarted, message: 'Baseline target or outcome did not resolve within the operation budget.' });
      return { workflow: workflow.name, status: 'failed', verified: false, durationMs: performance.now() - started, steps };
    }
  }
  return { workflow: workflow.name, status: 'passed', verified: true, durationMs: performance.now() - started, steps };
}

export function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return Math.round((sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2) * 10) / 10;
}

export function summarize(trials: Trial[]) {
  return policies.map(policy => {
    const rows = trials.filter(row => row.policy === policy);
    const recoverable = rows.filter(row => row.group === 'recoverable');
    const refusal = rows.filter(row => row.expectation === 'abstain');
    return {
      policy, trials: rows.length,
      completed: rows.filter(row => row.taskCompleted).length,
      verifiedCompleted: rows.filter(row => row.verifiedCompletion).length,
      incorrectActionTrials: rows.filter(row => row.state.wrongActions > 0).length,
      incorrectActions: rows.reduce((total, row) => total + row.state.wrongActions, 0),
      safeAbstentions: refusal.filter(row => row.safeAbstention).length,
      safeStops: refusal.filter(row => row.safeStop).length,
      refusalTrials: refusal.length,
      recoverableCompleted: recoverable.filter(row => row.taskCompleted).length,
      recoverableTrials: recoverable.length,
      originalMedianMs: median(rows.filter(row => row.variant === 'original').map(row => row.durationMs)),
      completedMedianMs: median(rows.filter(row => row.taskCompleted).map(row => row.durationMs)),
      allMedianMs: median(rows.map(row => row.durationMs)),
    };
  });
}

export async function runBenchmark(iterations = 3, timeoutMs = 900) {
  if (!Number.isInteger(iterations) || iterations < 1 || iterations > 20) throw new Error('Iterations must be an integer from 1 to 20.');
  const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const artifactHashes: Record<string, string> = {};
  for (const relative of ['dist/runner.js', 'dist/recovery.js', 'dist/demo.js', 'benchmarks/run.ts', 'package-lock.json']) {
    artifactHashes[relative] = createHash('sha256').update(await readFile(path.join(projectRoot, relative))).digest('hex');
  }
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
    res.end(benchmarkHtml(url.searchParams.get('variant') ?? 'original'));
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No fixture address');
  const origin = `http://127.0.0.1:${address.port}`;
  let browser: Awaited<ReturnType<typeof chromium.launch>>;
  try { browser = await chromium.launch(); }
  catch (error) {
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
    throw error;
  }
  const trials: Trial[] = [];
  try {
    // Rotate policy order each iteration to reduce a fixed warm-up/order bias.
    for (let iteration = 1; iteration <= iterations; iteration++) {
      for (const scenario of cases) {
        for (let policyIndex = 0; policyIndex < policies.length; policyIndex++) {
          const policy = policies[(policyIndex + iteration - 1) % policies.length];
          const context = await browser.newContext({ serviceWorkers: 'block' });
          const page = await context.newPage();
          const workflow = demoWorkflow(origin);
          workflow.steps[0].url = `${origin}/demo?variant=${scenario.variant}`;
          const note = `Benchmark note ${iteration}: ${scenario.variant}`;
          const started = performance.now();
          let result: RunResult;
          try {
            result = policy === 'recovery'
              ? await runOnPage(page, workflow, { inputs: { note }, timeoutMs, strategy: 'recovery' })
              : await runBaseline(page, workflow, policy, note, timeoutMs);
            const durationMs = Math.round((performance.now() - started) * 10) / 10;
            const state = await page.evaluate(() => (window as unknown as { fixtureState: FixtureState }).fixtureState);
            if (!state) throw new Error('Fixture ground truth is missing');
            const taskCompleted = state.saved === note && state.saveCount === 1 && state.wrongActions === 0;
            const safeStop = state.saveCount === 0 && state.wrongActions === 0 && result.status !== 'passed';
            trials.push({ policy, ...scenario, iteration, durationMs, state, taskCompleted, verifiedCompletion: taskCompleted && result.verified && result.status === 'passed', safeStop, safeAbstention: safeStop && result.status === 'abstained', result });
            process.stdout.write(`${iteration}/${iterations} ${scenario.variant.padEnd(18)} ${policy.padEnd(9)} ${taskCompleted ? 'complete' : result.status}${state.wrongActions ? ' WRONG ACTION' : ''}\n`);
          } finally { await context.close(); }
        }
      }
    }
  } finally {
    await browser.close();
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    environment: { node: process.version, platform: process.platform, arch: process.arch, browser: browser.version() },
    artifactHashes,
    iterations, operationTimeoutMs: timeoutMs,
    scope: 'Controlled local dispatch-note fixtures; no real-world reliability claim; no trained model; no held-out evaluation claim.',
    summaries: summarize(trials), trials,
  };
}

function reportMarkdown(report: Awaited<ReturnType<typeof runBenchmark>>) {
  const row = (s: typeof report.summaries[number]) => `| ${s.policy} | ${s.completed}/${s.trials} | ${s.incorrectActionTrials} | ${s.safeAbstentions}/${s.refusalTrials} | ${s.safeStops}/${s.refusalTrials} | ${s.recoverableCompleted}/${s.recoverableTrials} | ${s.originalMedianMs} |`;
  const recovery = report.summaries.find(summary => summary.policy === 'recovery')!;
  const selectors = report.summaries.find(summary => summary.policy === 'selector')!;
  const semantics = report.summaries.find(summary => summary.policy === 'semantic')!;
  const controlDifference = recovery.originalMedianMs !== null && selectors.originalMedianMs !== null ? Math.round((recovery.originalMedianMs - selectors.originalMedianMs) * 10) / 10 : null;
  const semanticDifference = recovery.originalMedianMs !== null && semantics.originalMedianMs !== null ? Math.round((recovery.originalMedianMs - semantics.originalMedianMs) * 10) / 10 : null;
  return `# Controlled browser benchmark\n\nGenerated ${report.generatedAt}. Full per-trial evidence: [results.json](../benchmarks/results.json).\n\n## Reproduce\n\n\`\`\`sh\nnpm ci\nnpx playwright install chromium\nnpm run bench\n# Optional: npm run bench -- --repetitions 5\n\`\`\`\n\n${report.iterations} repetitions of ${cases.length} local scenarios for each of four policies. Each policy uses the same ${report.operationTimeoutMs} ms timeout setting for target resolution, actions, and assertions. A resolution wait and a subsequent action can each consume this setting; elapsed time is recorded directly. Each trial uses a fresh browser context; browser launch and context creation are excluded from elapsed time. Policy order rotates between repetitions. The JSON includes SHA-256 hashes of the runtime, fixture, benchmark source, and dependency lockfile read before execution. Environment: Node ${report.environment.node}; ${report.environment.platform}/${report.environment.arch}; Chromium ${report.environment.browser}.\n\n## Observed results\n\n| Policy | Task completed | Trials with wrong action | Safe abstentions | Safe stops | Recoverable changes completed | Original median ms |\n| --- | --- | --- | --- | --- | --- | --- |\n${report.summaries.map(row).join('\n')}\n\nTask completion is independent fixture ground truth: the exact input was saved once and no decoy action fired. Wrong actions count clicks on the instrumented delete decoy, not merely a failed assertion. Safe abstention means an explicit abstained result with zero saves and zero decoy actions on a case designated for refusal. Safe stop also includes timeout/failure before side effects. These measures are separated because a timeout is not an explained abstention.\n\nOn the unchanged control, recovery's measured median difference was ${controlDifference} ms relative to the selector baseline and ${semanticDifference} ms relative to the semantic baseline. These tiny local samples are timing observations, not statistically supported speed claims. All-case medians in JSON include intentional waits and failures and should not be interpreted as runtime overhead.\n\n## Policies\n\nThe three baselines are implemented independently in [run.ts](../benchmarks/run.ts) and do not call ReplaySmith's score or resolver. They share navigation, input, exact receipt checking, and operation budgets.\n\n* **selector:** ordinary first recorded CSS selector with Playwright's native actionability/strictness checks; no semantic identity check.\n* **semantic:** exact role/name, label, test-ID, placeholder, or text locator. It uses the first available locator contract and Playwright's native strictness and waits.\n* **heuristic:** existing recorded selector, then unique exact semantic target, then first visible same-tag candidate with any name/text token overlap. It has no confidence margin and can choose the wrong equivalent-looking control.\n* **recovery:** the actual exported ReplaySmith runtime with its selector evidence checks, semantic candidates, deterministic evidence ranking, threshold/margin refusal, and outcome verification.\n\n## Scenarios and limits\n\n| Scenario | Change | Declared expectation |\n| --- | --- | --- |\n| original | Unchanged form | Complete |\n| id-drift | Field and button IDs change | Complete |\n| wrapper-drift | Button ID changes and wrapper is inserted | Complete |\n| wording-extension | Button becomes “Save draft now”; old ID removed | Complete |\n| reused-id | Old save ID moves to a delete decoy | Complete without clicking decoy |\n| delayed | Replacement button arrives after 450 ms | Complete within operation budget |\n| renamed | Button becomes “Store draft”; no synonym inference assumed | Abstain |\n| ambiguous | Two identical-label controls; the first is a decoy | Abstain |\n| missing | Save control removed | Abstain |\n| disabled | Save control disabled | Abstain |\n| wrong-outcome | Click handler saves corrupted contents | Fail verification |\n\nFixtures derive from [demo.ts](../src/demo.ts). The benchmark preserves the note field ID except in id-drift, isolating each button mutation so a raw-selector trial can reach the reused-ID decoy. Changed button IDs and the fixture's independently instrumented side effects remain intact. The wrapper and wording-extension mutations are applied in the benchmark server. In the ambiguous case the first identical-label control is an instrumented decoy, making arbitrary selection observably incorrect.\n\nThis is a small synthetic regression suite, built alongside the implementation. It is not a held-out evaluation, production-site study, or evidence of universal self-healing. Recoverable cases were declared before execution; results are not filtered to successful runs. No ranking weights or thresholds are tuned by this benchmark. The synonym rename intentionally remains outside supported inference. Missing/ambiguous/disabled targets should stop without actions; the corrupted outcome must never be marked verified.\n\nA run exits unsuccessfully if recovery clicks a decoy, falsely reports a corrupted outcome verified, fails a scenario declared complete, or fails to explicitly abstain on a refusal scenario. Other policies' failures are observations, not benchmark errors.\n`;
}

export function parseBenchmarkArgs(args: string[], environmentIterations?: string): { repetitions: number; help: boolean } {
  if (args.includes('--help') || args.includes('-h')) return { repetitions: 3, help: true };
  let explicit: string | undefined;
  for (let index = 0; index < args.length; index++) {
    const argument = args[index];
    if (argument === '--repetitions' || argument.startsWith('--repetitions=')) {
      if (explicit !== undefined) throw new Error('Specify --repetitions only once.');
      explicit = argument === '--repetitions' ? args[++index] : argument.slice('--repetitions='.length);
      if (!explicit || explicit.startsWith('-')) throw new Error('--repetitions requires an integer from 1 to 20.');
    } else throw new Error(`Unknown benchmark option: ${argument}. Use --help.`);
  }
  const repetitions = Number(explicit ?? environmentIterations ?? 3);
  if (!Number.isInteger(repetitions) || repetitions < 1 || repetitions > 20) throw new Error('Repetitions must be an integer from 1 to 20.');
  return { repetitions, help: false };
}

export async function main(args = process.argv.slice(2)) {
  const options = parseBenchmarkArgs(args, process.env.BENCH_ITERATIONS);
  if (options.help) {
    process.stdout.write('Usage: npm run bench -- [--repetitions <1-20>] [--help]\n\nRuns 11 controlled scenarios against four browser policies.\nDefault: 3 repetitions. BENCH_ITERATIONS provides an environment fallback;\n--repetitions takes precedence. Writes benchmarks/results.json and docs/benchmarks.md.\n');
    return;
  }
  const report = await runBenchmark(options.repetitions);
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  await mkdir(path.join(root, 'benchmarks'), { recursive: true });
  await writeFile(path.join(root, 'benchmarks/results.json'), JSON.stringify(report, null, 2) + '\n');
  await writeFile(path.join(root, 'docs/benchmarks.md'), reportMarkdown(report));
  process.stdout.write(`Saved ${report.trials.length} actual browser trials to benchmarks/results.json\n`);
  const regressions = report.trials.filter(trial => trial.policy === 'recovery' && (trial.state.wrongActions > 0 || (trial.expectation === 'complete' && !trial.verifiedCompletion) || (trial.expectation === 'abstain' && !trial.safeAbstention) || (trial.variant === 'wrong-outcome' && trial.result.verified)));
  if (regressions.length) {
    process.stderr.write(`Recovery acceptance failures: ${regressions.map(trial => `${trial.variant}#${trial.iteration}`).join(', ')}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
