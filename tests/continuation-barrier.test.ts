import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { runOnPage } from '../src/runner.js';

const origin = 'http://replaysmith-owned.invalid';
const target = (id: string, name: string) => ({ selectors: [`#${id}`], evidence: { role: 'button', name } });
const assertion = { id: 'check', action: 'assert', assertion: { kind: 'text', value: 'Done', target: { selectors: ['output'], evidence: { tag: 'output' } } } };

for (const kind of ['changed', 'unobservable', 'matched'] as const) test(`${kind} observation controls later native actions`, async () => {
  const browser = await chromium.launch({ executablePath: process.env.REPLAYSMITH_TEST_CHROMIUM, headless: true, args: ['--disable-background-networking'] });
  const context = await browser.newContext({ offline: true, serviceWorkers: 'block' });
  await context.routeWebSocket('**/*', ws => ws.close());
  const page = await context.newPage();
  const effect = kind === 'unobservable' ? 'this.remove()' : kind === 'changed' ? "this.textContent='Paused'" : '';
  await page.route('**/*', r => r.fulfill({ contentType: 'text/html', body: `<button id="first" onclick="${effect};document.querySelector('output').textContent='Done'">Pause</button><button id="later" onclick="window.later++">Next</button><output>Waiting</output><script>window.later=0</script>` }));
  await page.goto(origin);
  try {
    const w:any = { version: 1, name: kind, inputs: {}, allowedOrigins: [origin], steps: [
      { id: 'first', action: 'click', target: target('first', 'Pause') }, assertion,
      { id: 'later', action: 'click', target: target('later', 'Next') },
      { id: 'final', action: 'assert', assertion: { kind: 'text', value: 'Done', target: { selectors: ['output'], evidence: { tag: 'output' } } } },
    ] };
    const report = await runOnPage(page, w, { timeoutMs: 2500 });
    const count = await page.evaluate(() => (window as any).later);
    assert.equal(report.steps[0].identityObservation, kind);
    assert.equal(report.steps[1].status, 'passed');
    if (kind === 'matched') { assert.equal(count, 1); assert.equal(report.status, 'passed'); assert.equal(report.verified, true); }
    else { assert.equal(count, 0); assert.equal(report.status, 'abstained'); assert.equal(report.verified, false); assert.equal(report.steps[2].status, 'abstained'); assert.match(report.steps[2].message ?? '', /earlier action.*dispatched.*action was not taken/); assert.equal(report.steps.length, 3); }
  } finally { await context.close(); await browser.close(); }
});

test('an intermediate assertion cannot clear a changed observation before navigation', async () => {
  const browser = await chromium.launch({ executablePath: process.env.REPLAYSMITH_TEST_CHROMIUM, headless: true, args: ['--disable-background-networking'] });
  const context = await browser.newContext({ offline: true, serviceWorkers: 'block' }); await context.routeWebSocket('**/*', ws => ws.close());
  const page = await context.newPage(); let requests = 0;
  await page.route('**/*', r => { requests++; return r.fulfill({ contentType: 'text/html', body: `<button id="first" onclick="this.textContent='Paused';document.querySelector('output').textContent='Done'">Pause</button><output>Waiting</output>` }); });
  await page.goto(origin);
  try { const w:any = { version: 1, name: 'navigation barrier', inputs: {}, allowedOrigins: [origin], steps: [{ id: 'first', action: 'click', target: target('first', 'Pause') }, assertion, { id: 'nav', action: 'navigate', url: origin + '/later' }] }; const report = await runOnPage(page, w, { timeoutMs: 2500 }); assert.equal(report.status, 'abstained'); assert.equal(report.steps[1].status, 'passed'); assert.equal(requests, 1); assert.equal(page.url(), origin + '/'); } finally { await context.close(); await browser.close(); }
});

test('normal form editing continues when target evidence remains matched', async () => {
  const browser = await chromium.launch({ executablePath: process.env.REPLAYSMITH_TEST_CHROMIUM, headless: true, args: ['--disable-background-networking'] });
  const context = await browser.newContext({ offline: true, serviceWorkers: 'block' }); await context.routeWebSocket('**/*', ws => ws.close());
  const page = await context.newPage(); await page.route('**/*', r => r.fulfill({ contentType: 'text/html', body: `<label for="name">Name</label><input id="name"><button id="save" type="button" onclick="document.querySelector('output').textContent=document.querySelector('#name').value">Save draft</button><output>Waiting</output>` })); await page.goto(origin);
  try { const w:any = { version: 1, name: 'normal draft', inputs: {}, allowedOrigins: [origin], steps: [{ id: 'fill', action: 'fill', value: 'Alice', target: { selectors: ['#name'], evidence: { role: 'textbox', name: 'Name' } } }, { id: 'save', action: 'click', target: target('save', 'Save draft') }, { id: 'check', action: 'assert', assertion: { kind: 'text', value: 'Alice', target: { selectors: ['output'], evidence: { tag: 'output' } } } }] }; const report = await runOnPage(page, w, { timeoutMs: 2500 }); assert.equal(report.status, 'passed', JSON.stringify(report)); assert.equal(report.verified, true); assert.equal(report.steps[0].identityObservation, 'matched'); assert.equal(report.steps[1].identityObservation, 'matched'); } finally { await context.close(); await browser.close(); }
});
