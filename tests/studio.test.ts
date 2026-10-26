import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { readFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startStudio } from '../src/server.js';

/** Drives the real served studio and real browser runner, without mocking API responses. */
test('studio imports, edits, verifies, exports and handles invalid source through the real UI', { timeout: 90_000 }, async () => {
  const studio = await startStudio(0);
  const directory = await mkdtemp(join(tmpdir(), 'replaysmith-studio-'));
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1100 }, deviceScaleFactor: 1 });
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  const capture = process.env.REPLAYSMITH_CAPTURE === '1';
  if (capture) await mkdir('assets', { recursive: true });
  try {
    await page.goto(studio.origin);
    await page.waitForFunction(() => (document.getElementById('workflow-name') as HTMLInputElement)?.value === 'Save a dispatch note');
    assert.equal(await page.locator('#workflow-status').textContent(), 'Not run');
    await page.getByRole('button', { name: 'Step 2: Write the dispatch note', exact: true }).click();
    await page.getByLabel('note', { exact: true }).fill('Send the calibration kit to Avery.');
    if (capture) await page.screenshot({ path: 'assets/studio.png', fullPage: true });

    // A changed input must reach the real browser and its explicit receipt assertion.
    await page.getByRole('button', { name: 'Run workflow', exact: false }).click();
    await page.getByRole('heading', { name: 'The outcome checks passed.', exact: true }).waitFor();
    assert.equal(await page.locator('#workflow-status').textContent(), 'Verified');
    assert.equal(await page.locator('.report-step').count(), 4);
    assert.equal(await page.locator('.result-tag').filter({ hasText: 'Passed' }).count(), 4);

    // Real Recorder JSON import, with semantic selector alternatives.
    const recording = {
      title: 'Imported dispatch recording',
      steps: [
        { type: 'navigate', url: `${studio.origin}/demo` },
        { type: 'change', selectors: [['#note'], ['aria/Dispatch note[role="textbox"]']], value: 'A reusable dispatch note' },
        { type: 'click', selectors: [['#save'], ['aria/Save draft[role="button"]']] },
      ],
    };
    await page.locator('#file-input').setInputFiles({ name: 'dispatch-recorder.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(recording)) });
    await page.getByText('Imported dispatch-recorder.json.', { exact: false }).waitFor();
    assert.equal(await page.locator('#workflow-name').inputValue(), recording.title);
    assert.equal(await page.locator('#step-list li').count(), 3);
    assert.equal(await page.locator('#workflow-status').textContent(), 'Not run');

    await page.getByRole('button', { name: 'Step 2: Fill Dispatch note', exact: true }).click();
    // Imports automatically create named inputs. A user can still replace a value
    // with a new literal and explicitly make a differently named input.
    assert.equal(await page.getByLabel('Value', { exact: true }).inputValue(), '{{dispatch_note}}');
    assert.equal(await page.getByRole('button', { name: '{ } Make input', exact: true }).count(), 0);
    await page.getByLabel('Value', { exact: true }).fill('An edited dispatch note');
    await page.getByRole('button', { name: 'Apply changes', exact: false }).click();
    await page.getByRole('button', { name: '{ } Make input', exact: true }).click();
    await page.getByLabel('Input name', { exact: true }).fill('note');
    await page.getByRole('button', { name: 'Create input', exact: true }).click();
    await page.getByLabel('note', { exact: true }).waitFor();
    assert.equal(await page.getByLabel('note', { exact: true }).inputValue(), 'An edited dispatch note');
    await page.getByLabel('note', { exact: true }).fill('Studio acceptance checked.');

    await page.getByRole('button', { name: 'Add outcome check', exact: false }).click();
    await page.getByLabel('CSS selector', { exact: true }).fill('#receipt');
    await page.getByLabel('Expected value', { exact: true }).fill('Draft saved: {{note}}');
    await page.getByLabel('Description', { exact: true }).last().fill('Confirm the saved dispatch note');
    await page.getByRole('button', { name: 'Add check', exact: true }).click();
    await page.getByRole('button', { name: 'Step 4: Confirm the saved dispatch note', exact: true }).waitFor();
    await page.getByRole('button', { name: 'Run workflow', exact: false }).click();
    await page.getByRole('heading', { name: 'The outcome checks passed.', exact: true }).waitFor();
    assert.equal(await page.locator('#workflow-status').textContent(), 'Verified');

    await page.getByRole('button', { name: 'Export', exact: false }).click();
    const playwrightDownload = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Playwright script', exact: false }).click();
    const script = await playwrightDownload;
    await script.saveAs(join(directory, 'workflow.mjs'));
    const code = await readFile(join(directory, 'workflow.mjs'), 'utf8');
    assert.match(code, /playwright/);
    assert.match(code, /Confirm the saved dispatch note/);
    const skillDownload = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Agent skill', exact: false }).click();
    const skill = await skillDownload;
    await skill.saveAs(join(directory, 'skill.zip'));
    const archive = await readFile(join(directory, 'skill.zip'));
    assert.equal(archive.readUInt32LE(0), 0x04034b50);
    assert.ok(archive.includes(Buffer.from('imported-dispatch-recording/SKILL.md')));
    assert.ok(archive.includes(Buffer.from('scripts/run.mjs')));
    assert.ok(archive.includes(Buffer.from('workflow.json')));
    await page.getByRole('button', { name: 'Close', exact: true }).click();

    await page.getByRole('tab', { name: 'Source', exact: false }).click();
    const validSource = await page.getByLabel('Workflow JSON source', { exact: true }).inputValue();
    await page.getByLabel('Workflow JSON source', { exact: true }).fill('{');
    await page.getByRole('button', { name: 'Validate & apply', exact: false }).click();
    await page.getByText('The source is not valid JSON.', { exact: false }).waitFor();
    // A parse error preserves the last successfully applied workflow.
    assert.equal(await page.locator('#workflow-name').inputValue(), recording.title);
    await page.getByLabel('Workflow JSON source', { exact: true }).fill(validSource);
    await page.getByRole('button', { name: 'Validate & apply', exact: false }).click();
    await page.getByText('Workflow source validated and applied.', { exact: true }).waitFor();
    assert.equal(await page.locator('#workflow-status').textContent(), 'Not run');

    await page.getByRole('tab', { name: 'Workflow', exact: false }).click();
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.getByRole('button', { name: 'Step 2: Fill Dispatch note', exact: true }).click();
    if (capture) await page.screenshot({ path: 'assets/studio-mobile.png', fullPage: true });
    assert.deepEqual(pageErrors, []);
  } finally {
    await browser.close();
    studio.server.closeAllConnections();
    await studio.close();
    await rm(directory, { recursive: true, force: true });
  }
});
