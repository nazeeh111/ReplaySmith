/** Capture actual local recording, editing, runs and exports. No mocked API responses. */
import { chromium, type Page } from 'playwright';
import { mkdir, writeFile, copyFile, access } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { startStudio } from '../src/server.js';
import { recordWorkflow } from '../src/recorder.js';
import type { RunResult, Workflow } from '../src/types.js';

const args = process.argv.slice(2);
if (args.includes('--help')) {
  console.log('Usage: npm run demo -- --out demo/captures-new [--publish-stills]\nCaptures the real product into a fresh directory. Rendering the editable launch composition is documented in demo/README.md.');
  process.exit(0);
}
const outIndex = args.indexOf('--out');
const output = resolve(outIndex >= 0 ? args[outIndex + 1] : `demo/captures-${new Date().toISOString().replace(/[:.]/g, '-')}`);
try { await access(output); throw new Error(`Capture destination already exists: ${output}. Use a fresh --out path.`); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
await mkdir(output, { recursive: true });
const studio = await startStudio(0);
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1100 }, deviceScaleFactor: 1 });
const reports: Record<string, RunResult> = {};
const pageErrors: string[] = [];
page.on('pageerror', error => pageErrors.push(error.message));
const shot = async (name: string, target?: string) => {
  if (target) await page.locator(target).screenshot({ path: join(output, name) });
  else await page.screenshot({ path: join(output, name), fullPage: true });
};
const saveSource = async (change: (workflow: Workflow) => void) => {
  await page.getByRole('tab', { name: 'Source', exact: false }).click();
  const workflow = JSON.parse(await page.locator('#source-editor').inputValue()) as Workflow;
  change(workflow);
  await page.locator('#source-editor').fill(JSON.stringify(workflow, null, 2));
  await page.getByRole('button', { name: 'Validate & apply', exact: false }).click();
  await page.getByText('Workflow source validated and applied.', { exact: true }).waitFor();
  await page.getByRole('tab', { name: 'Workflow', exact: false }).click();
};
const run = async (name: string) => {
  const response = page.waitForResponse(response => response.url() === `${studio.origin}/api/run` && response.request().method() === 'POST', { timeout: 90_000 });
  await page.getByRole('button', { name: 'Run workflow', exact: false }).click();
  const result = await (await response).json() as RunResult;
  reports[name] = result;
  await page.locator('#view-report:not([hidden])').waitFor();
  await page.locator('#run-button:not([disabled])').waitFor();
  return result;
};
try {
  // This is an actual demonstration captured by the recorder, not a hand-authored recording.
  const recording = await recordWorkflow(`${studio.origin}/demo`, { headless: true, onReady: async context => {
    const demonstrated = context.pages()[0];
    await demonstrated.setViewportSize({ width: 1440, height: 1000 });
    await demonstrated.getByLabel('Dispatch note', { exact: true }).fill('Send the field kit to Avery.');
    await demonstrated.getByRole('button', { name: 'Save draft', exact: true }).click();
    await demonstrated.locator('#receipt').getByText('Draft saved: Send the field kit to Avery.', { exact: true }).waitFor();
    await demonstrated.screenshot({ path: join(output, '00-demonstration.png'), fullPage: true });
    await demonstrated.locator('main').screenshot({ path: join(output, '00-task.png') });
    await demonstrated.locator('#replaysmith-recorder').getByRole('button', { name: 'Assert text', exact: true }).click();
    await demonstrated.locator('#receipt').click();
    await demonstrated.locator('#replaysmith-recorder').getByRole('button', { name: 'Stop & review', exact: true }).click();
  } });
  await writeFile(join(output, 'recorded-demonstration.json'), `${JSON.stringify(recording, null, 2)}\n`);
  if (recording.steps.map(step => step.action).join(',') !== 'navigate,fill,click,assert') throw new Error('The real demonstration did not capture the expected steps.');

  await page.goto(studio.origin);
  await page.waitForFunction(() => Boolean((document.getElementById('workflow-name') as HTMLInputElement)?.value));
  await page.locator('#file-input').setInputFiles({ name: 'recorded-demonstration.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(recording)) });
  await page.getByText('Imported recorded-demonstration.json.', { exact: false }).waitFor();
  await shot('01-import.png');

  let inputKey = '';
  await saveSource(workflow => {
    inputKey = workflow.steps[1].value?.match(/^\{\{([A-Za-z_][A-Za-z0-9_]*)\}\}$/)?.[1] || '';
    if (!inputKey || !workflow.inputs[inputKey]) throw new Error('Import did not automatically prepare a reusable input.');
    workflow.name = 'Save a dispatch note';
    const descriptions = ['Open the dispatch desk', 'Write the dispatch note', 'Save the draft', 'Verify the saved note'];
    workflow.steps.forEach((step, index) => { step.description = descriptions[index]; });
    if (workflow.steps[3].assertion!.value !== `Draft saved: {{${inputKey}}}`) throw new Error('Auto-prepare did not link the recorded assertion to the input.');
  });
  await page.getByRole('button', { name: 'Step 2: Write the dispatch note', exact: true }).click();
  await page.getByLabel(inputKey, { exact: true }).fill('Send the calibration kit to Avery.');
  await page.locator('#notice button').click();
  await shot('02-studio.png');
  await shot('02-editor.png', '#step-editor');
  await shot('02-config.png', '.run-sidebar');
  await shot('02-action.png', '.editor-card:first-of-type');
  await shot('02-input.png', '.config-section:first-of-type');
  const normal = await run('original');
  if (normal.status !== 'passed' || !normal.verified) throw new Error('The original demo run did not verify.');
  await shot('03-verified.png');
  await shot('03-report.png', '#report-content');

  await saveSource(workflow => { workflow.steps[0].url = `${studio.origin}/demo?variant=reused-id`; });
  const changed = await run('reused-id');
  if (changed.status !== 'passed' || !changed.verified || !changed.steps.some(step => step.status === 'recovered')) throw new Error('The controlled selector-reuse case did not recover and verify.');
  await shot('04-recovered.png');
  await shot('04-report.png', '#report-content');

  await saveSource(workflow => { workflow.steps[0].url = `${studio.origin}/demo?variant=ambiguous`; });
  const uncertain = await run('ambiguous');
  if (uncertain.status !== 'abstained') throw new Error('The ambiguous fixture did not abstain.');
  await shot('05-abstained.png');
  await shot('05-report.png', '#report-content');

  await saveSource(workflow => { workflow.steps[0].url = `${studio.origin}/demo`; });
  const restored = await run('restored');
  if (restored.status !== 'passed' || !restored.verified) throw new Error('The restored export workflow did not verify.');
  await page.getByRole('button', { name: 'Export', exact: false }).click();
  await shot('06-export.png', '#export-dialog');
  let pending = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Playwright script', exact: false }).click();
  await (await pending).saveAs(join(output, 'workflow.mjs'));
  pending = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Agent skill', exact: false }).click();
  await (await pending).saveAs(join(output, 'agent-skill.zip'));
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await page.getByRole('tab', { name: 'Source', exact: false }).click();
  await writeFile(join(output, 'verified-workflow.json'), `${await page.locator('#source-editor').inputValue()}\n`);

  await page.getByRole('tab', { name: 'Workflow', exact: false }).click();
  await page.getByRole('button', { name: 'Step 2: Write the dispatch note', exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  const mobileOverflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
  if (mobileOverflow || pageErrors.length) throw new Error(`Capture UI check failed: ${JSON.stringify({ mobileOverflow, pageErrors })}`);
  await shot('07-mobile.png');
  await writeFile(join(output, 'run-results.json'), `${JSON.stringify(reports, null, 2)}\n`);
  await writeFile(join(output, 'provenance.json'), `${JSON.stringify({ capturedAt: new Date().toISOString(), source: 'scripts/capture-demo.ts', method: 'Real recorder demonstration, imported through the local studio UI; real Playwright runner, no mocked responses', viewport: { width: 1440, height: 1100 }, mobile: { width: 390, height: 844 }, mobileOverflow, pageErrors, notes: 'All text/data are fictional local fixture values. Browser timings are observed values, not benchmark claims.' }, null, 2)}\n`);
  if (args.includes('--publish-stills')) {
    await mkdir('assets', { recursive: true });
    await copyFile(join(output, '02-studio.png'), 'assets/studio.png');
    await copyFile(join(output, '07-mobile.png'), 'assets/studio-mobile.png');
    await copyFile(join(output, '04-recovered.png'), 'assets/recovery.png');
    await copyFile(join(output, '05-abstained.png'), 'assets/abstention.png');
  }
  console.log(JSON.stringify({ output, realRuns: Object.fromEntries(Object.entries(reports).map(([name, result]) => [name, { status: result.status, verified: result.verified }])), mobileOverflow, pageErrors }));
} finally {
  await browser.close();
  studio.server.closeAllConnections();
  await studio.close();
}
