/** Actual public-site acceptance probe. Only ephemeral browser-local TodoMVC data. */
import { chromium } from 'playwright';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFile as execFileCallback } from 'node:child_process';
import { promisify } from 'node:util';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const execFile = promisify(execFileCallback);
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = resolve(process.env.LIVE_OUT ?? join(root, `artifacts/live-web/todomvc-${new Date().toISOString().replace(/[:.]/g,'-')}`));
const runtimeDirectory = resolve(process.env.LIVE_RUNTIME_DIR ?? join(root, 'dist'));
const { recordWorkflow, prepareWorkflow, runOnPage, exportPlaywright, exportSkill, skillName } = await import(pathToFileURL(join(runtimeDirectory, 'index.js')).href);
const packageMetadata = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
const url = 'https://todomvc.com/examples/react/dist/';
const originalValue = 'ReplaySmith recorded TodoMVC task';
const changedValue = 'ReplaySmith changed TodoMVC input';
const report = {
  startedAt: new Date().toISOString(), url,
  scope: 'Public TodoMVC React application. Fresh browser profiles; only browser-local todo creation, filtering, and toggling. No account or submission to a real service. No target or selector mutation for recovery testing.',
  packageVersion: packageMetadata.version, runtimeDirectory,
  runtimeHashes: {}, provenanceHashes: {}, demonstration: {}, steps: {}, exports: {}, errors: [],
};
await mkdir(dirname(output), { recursive: true });await mkdir(output);
for (const name of ['recorder', 'prepare', 'runner', 'evidence', 'recovery', 'exporter']) {
  const source = join(runtimeDirectory, `${name}.js`);
  try { report.runtimeHashes[name] = createHash('sha256').update(await readFile(source)).digest('hex'); }
  catch (error) { if (name !== 'evidence' || error.code !== 'ENOENT') throw error; }
}
for (const relative of ['package.json', 'package-lock.json', 'scripts/live-todomvc.mjs']) {
  report.provenanceHashes[relative] = createHash('sha256').update(await readFile(join(root, relative))).digest('hex');
}
const save = async () => writeFile(join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n');
const saveJSON = async (name, value) => writeFile(join(output, name), JSON.stringify(value, null, 2) + '\n');
const pageEvidence = async (page, prefix) => {
  await writeFile(join(output, `${prefix}-dom.html`), await page.content());
  await writeFile(join(output, `${prefix}-accessibility.txt`), await page.locator('body').ariaSnapshot());
  await page.screenshot({ path: join(output, `${prefix}.png`), fullPage: true });
};
const outcome = async page => ({
  url: page.url(),
  visibleTodos: await page.locator('.todo-list li label').allTextContents(),
  completedTodos: await page.locator('.todo-list li.completed label').allTextContents(),
  checked: await page.locator('.todo-list li input[type="checkbox"]').isChecked(),
  count: await page.locator('.todo-count').innerText(),
  storageKeys: await page.evaluate(() => Object.keys(localStorage)),
});

try {
  const workflow = await recordWorkflow(url, {
    headless: true,
    signal: AbortSignal.timeout(90_000),
    onReady: async context => {
      const page = context.pages()[0];
      await page.setViewportSize({ width: 1440, height: 1000 });
      await page.getByRole('textbox', { name: 'New Todo Input', exact: true }).fill(originalValue);
      await page.getByRole('textbox', { name: 'New Todo Input', exact: true }).press('Enter');
      await page.locator('.todo-list li label').getByText(originalValue, { exact: true }).waitFor();
      await page.getByRole('link', { name: 'Active', exact: true }).click();
      await page.locator('.todo-list li input[type="checkbox"]').click();
      await page.getByRole('link', { name: 'Completed', exact: true }).click();
      await page.locator('.todo-list li.completed label').getByText(originalValue, { exact: true }).waitFor();
      report.demonstration = await outcome(page);
      await pageEvidence(page, 'recorded-outcome');
      await page.locator('#replaysmith-recorder').getByRole('button', { name: 'Assert text', exact: true }).click();
      await page.locator('.todo-list li.completed label').click();
      await page.locator('#replaysmith-recorder').getByRole('button', { name: 'Stop & review', exact: true }).click();
    },
  });
  workflow.name = 'Complete a TodoMVC task';
  await saveJSON('recorded-workflow.json', workflow);
  report.steps.recordedActions = workflow.steps.map(step => step.action);
  report.steps.recordedCount = workflow.steps.length;
  await save();

  const prepared = prepareWorkflow(workflow);
  await saveJSON('prepared-workflow.json', prepared);
  const inputName = Object.keys(prepared.inputs).find(name => prepared.inputs[name].default === originalValue);
  if (!inputName) throw new Error('prepareWorkflow did not create a named input for the demonstrated todo.');
  report.steps.inputName = inputName;
  report.steps.preparedAssertion = prepared.steps.at(-1)?.assertion;
  const browser = await chromium.launch();report.browserVersion=browser.version();
  try {
    const context = await browser.newContext({ serviceWorkers: 'block' });
    const page = await context.newPage();
    const result = await runOnPage(page, prepared, { inputs: { [inputName]: changedValue }, timeoutMs: 15_000 });
    report.steps.changedInputReplay = result;
    await saveJSON('changed-input-run.json', result);
    await pageEvidence(page, 'replayed-outcome');
    report.steps.actualChangedOutcome = await outcome(page);
    await save();
    if (result.status !== 'passed' || !result.verified || !report.steps.actualChangedOutcome.completedTodos.includes(changedValue)) {
      report.errors.push({ message: 'Fresh-context replay did not complete and verify the changed todo.' });
      process.exitCode = 1;
    }
  } finally { await browser.close(); }

  const standalone = join(output, 'workflow.mjs');
  await writeFile(standalone, exportPlaywright(prepared));
  const skillDirectory = join(output, 'skill', skillName(prepared));
  for (const [relative, content] of Object.entries(exportSkill(prepared))) {
    const destination = join(skillDirectory, relative);
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, content);
  }
  for (const [label, script, text] of [
    ['standalone', standalone, 'ReplaySmith standalone export todo'],
    ['skill', join(skillDirectory, 'scripts/run.mjs'), 'ReplaySmith agent skill export todo'],
  ]) {
    try {
      const result = await execFile(process.execPath, [script, '--timeout-ms', '15000', '--inputs', JSON.stringify({ [inputName]: text })], { cwd: root, timeout: 90_000, maxBuffer: 2 * 1024 * 1024 });
      report.exports[label] = { exitCode: 0, report: JSON.parse(result.stdout), stderr: result.stderr };
    } catch (error) {
      let parsed;
      try { parsed = JSON.parse(error.stdout); } catch { /* process failed before producing a run report */ }
      report.exports[label] = { exitCode: error.code, report: parsed, stdout: error.stdout, stderr: error.stderr, error: error.message };
    }
    await saveJSON(`${label}-export-run.json`, report.exports[label]);
    await save();
  }
  if (Object.values(report.exports).some(result => result.exitCode !== 0 || result.report?.status !== 'passed' || !result.report?.verified)) throw new Error('At least one actual generated export did not verify the public-site workflow.');
} catch (error) {
  report.errors.push({ message: error.message, stack: error.stack });
  process.exitCode = 1;
} finally {
  report.completedAt = new Date().toISOString();
  await save();
  console.log(JSON.stringify({
    site: 'todomvc', packageVersion: report.packageVersion,
    recordedActions: report.steps.recordedActions,
    replay: report.steps.changedInputReplay?.status,
    verified: report.steps.changedInputReplay?.verified,
    actualChangedOutcome: report.steps.actualChangedOutcome,
    exports: Object.fromEntries(Object.entries(report.exports).map(([name, result]) => [name, { exitCode: result.exitCode, status: result.report?.status, verified: result.report?.verified }])),
    errors: report.errors.map(error => error.message),
    report: join(output, 'report.json'),
  }));
}
