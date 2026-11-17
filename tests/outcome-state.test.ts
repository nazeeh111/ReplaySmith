import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { chromium, type Browser } from 'playwright';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { runOnPage } from '../src/runner.js';
import { validateWorkflow } from '../src/workflow.js';
import { exportPlaywright, exportSkill } from '../src/exporter.js';
import type { Assertion, Workflow } from '../src/types.js';

let server: Server, browser: Browser, origin: string;
before(async () => {
  server = createServer((_req, res) => {
    res.setHeader('Content-Type', 'text/html');
    res.end(`<input id="note" aria-label="Note" value="Synthetic draft">
      <input id="enabled" type="checkbox" aria-label="Enabled">
      <input id="first" type="radio" name="choice" aria-label="First">
      <input id="second" type="radio" name="choice" aria-label="Second" checked>
      <input id="mixed" type="checkbox" aria-label="Mixed">
      <input id="hidden" type="checkbox" hidden>
      <input class="duplicate" type="checkbox"><input class="duplicate" type="checkbox">
      <button id="apply" onclick="setTimeout(()=>{note.value='';enabled.checked=true;first.checked=true},120)">Apply settings</button>
      <script>document.querySelector('#mixed').indeterminate=true;</script>`);
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  browser = await chromium.launch({ headless: true });
});
after(async () => { await browser?.close(); await new Promise<void>(resolve => server.close(() => resolve())); });
const target = (selector: string) => ({ selectors: [selector], evidence: {} });
const workflow = (...checks: Assertion[]): Workflow => ({
  version: 1, name: 'Verify settings state', inputs: {}, allowedOrigins: [origin],
  steps: [{ id: 'open', action: 'navigate', url: origin },
    ...checks.map((assertion, i) => ({ id: `check-${i}`, action: 'assert' as const, assertion }))],
});

test('clear and checkbox/radio outcomes wait for actual asynchronous state changes', { timeout: 60000 }, async () => {
  const task = workflow(
    { kind: 'value', target: target('#note'), value: '' },
    { kind: 'checked', target: target('#enabled') },
    { kind: 'checked', target: target('#first') },
    { kind: 'unchecked', target: target('#second') },
  );
  task.steps.splice(1, 0, { id: 'apply', action: 'click', target: { selectors: ['#apply'], evidence: { role: 'button', name: 'Apply settings' } } });
  const page = await browser.newPage();
  try {
    const result = await runOnPage(page, task, { timeoutMs: 1500 });
    assert.equal(result.status, 'passed', JSON.stringify(result));
    assert.equal(result.verified, true);
    assert.equal(await page.locator('#note').inputValue(), '');
    assert.equal(await page.locator('#enabled').isChecked(), true);
    assert.equal(await page.locator('#second').isChecked(), false);
    // Both executable export formats must run this same real workflow.
    const directory = await mkdtemp(join(process.cwd(), '.outcome-export-'));
    try {
      for (const [name, code] of [['playwright', exportPlaywright(task)], ['skill', exportSkill(task)['scripts/run.mjs']]]) {
        const file = join(directory, `${name}.mjs`); await writeFile(file, code);
        const child = spawn(process.execPath, [file, '--timeout-ms', '1500'], { cwd: process.cwd(), timeout: 20000, stdio: ['ignore', 'pipe', 'pipe'] });
        let out = '', err = ''; child.stdout.on('data', data => out += data); child.stderr.on('data', data => err += data);
        const exit = await new Promise<number | null>((resolve, reject) => { child.on('error', reject); child.on('exit', resolve); });
        assert.equal(exit, 0, err); assert.equal(JSON.parse(out).verified, true);
      }
    } finally { await rm(directory, { recursive: true, force: true }); }
  } finally { await page.close(); }
});

test('native value on is not a checked-state witness; wrong or mixed states fail', async () => {
  for (const check of [
    { kind: 'checked', target: target('#enabled') },
    { kind: 'unchecked', target: target('#second') },
    { kind: 'checked', target: target('#mixed') },
    { kind: 'unchecked', target: target('#mixed') },
    { kind: 'unchecked', target: target('#note') },
  ] as Assertion[]) {
    const page = await browser.newPage();
    try {
      const result = await runOnPage(page, workflow(check), { timeoutMs: 250 });
      assert.equal(result.status, 'failed', JSON.stringify(result)); assert.equal(result.verified, false);
      assert.equal(await page.locator('#enabled').inputValue(), 'on');
      assert.equal(await page.locator('#enabled').isChecked(), false);
    } finally { await page.close(); }
  }
});

test('unchecked requires one visible native target; absence and ambiguity abstain', async () => {
  for (const selector of ['#missing', '#hidden', '.duplicate']) {
    const page = await browser.newPage();
    try {
      const result = await runOnPage(page, workflow({ kind: 'unchecked', target: target(selector) }), { timeoutMs: 250 });
      assert.equal(result.status, 'abstained', JSON.stringify(result)); assert.equal(result.verified, false);
    } finally { await page.close(); }
  }
});

test('new assertion contracts survive validation while incomplete checks are rejected', () => {
  assert.doesNotThrow(() => validateWorkflow(workflow({ kind: 'value', target: target('#note'), value: '' })));
  for (const kind of ['checked', 'unchecked'] as const) {
    assert.doesNotThrow(() => validateWorkflow(workflow({ kind, target: target('#enabled') })));
    assert.throws(() => validateWorkflow(workflow({ kind, target: target('#enabled'), value: 'false' })), /do not use a value/);
  }
  assert.throws(() => validateWorkflow(workflow({ kind: 'value', target: target('#note') })), /must be a string/);
  assert.throws(() => validateWorkflow(workflow({ kind: 'text', target: target('#note'), value: '' })), /cannot be empty/);
});
