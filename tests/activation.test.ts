import assert from 'node:assert/strict';
import test from 'node:test';
import { chromium } from 'playwright';
import { runOnPage } from '../src/runner.js';
import type { Step, Workflow } from '../src/types.js';

const origin = 'http://replaysmith-owned.invalid';
const button = '<button type="button" id="preview">Preview</button>';
const target = { selectors: ['#preview'], evidence: { tag: 'button', type: 'button', role: 'button', name: 'Preview' } };
const activate: Step = { id: 'preview', action: 'activate', target };
const check: Step = { id: 'check', action: 'assert', assertion: { kind: 'text', target: { selectors: ['output'], evidence: { tag: 'output' } }, value: 'Preview ready' } };

test('recorded DOM activation and native inputs use their documented browser events', async t => {
  const browser = await chromium.launch();
  t.after(() => browser.close());
  const context = await browser.newContext({ offline: true, serviceWorkers: 'block' });
  const page = await context.newPage();
  let control = button;
  await page.route('**/*', route => route.fulfill({
    contentType: 'text/html',
    body: `${control}<output>Waiting</output><script>
      window.events = [];
      for (const type of ['mousedown', 'keydown', 'click']) {
        document.addEventListener(type, e => {
          window.events.push({ type, trusted: e.isTrusted, id: e.target.id });
          if (type === 'click') document.querySelector('output').textContent = 'Preview ready';
        });
      }
    </script>`
  }));
  const run = async (steps: Step[], requireFirstTargetIdentity = false) => {
    await page.goto(origin);
    const task: Workflow = { version: 1, name: 'Local preview', allowedOrigins: [origin], inputs: {}, steps };
    const report = await runOnPage(page, task, { timeoutMs: 1500, allowSensitive: true, requireFirstTargetIdentity });
    const events = await page.evaluate(() => (window as Window & { events?: unknown }).events);
    return { report, events };
  };
  for (const [label, first, types, trusted] of [
    ['DOM activation', activate, ['click'], false],
    ['native pointer', { ...activate, action: 'click' }, ['mousedown', 'click'], true],
    ['native keyboard', { ...activate, action: 'press', key: 'Enter' }, ['keydown', 'click'], true],
  ] as const) {
    await t.test(label, async () => {
      const { report, events } = await run([first, check]);
      assert.equal(report.verified, true, JSON.stringify(report));
      assert.deepEqual(events, types.map(type => ({ type, trusted, id: 'preview' })));
    });
  }
  await t.test('strict first target promotes only the first qualifying native click', async () => {
    const click: Step = { ...activate, action: 'click', target: { ...target, selectors: ['#preview', 'text=Preview'] } };
    const before: Step = { id: 'before', action: 'assert', assertion: { kind: 'visible', target } };
    const { report, events } = await run([before, click, { ...click, id: 'next' }, check], true);
    assert.equal(report.verified, true, JSON.stringify(report));
    assert.match(report.steps[1].message ?? '', /synthetic activation/);
    assert.deepEqual(events, [
      { type: 'click', trusted: false, id: 'preview' },
      { type: 'mousedown', trusted: true, id: 'preview' },
      { type: 'click', trusted: true, id: 'preview' },
    ]);
  });
  await t.test('strict first target abstains before unsupported keyboard, fill or select input', async () => {
    const unsupported: Step[] = [
      { ...activate, action: 'press', key: 'Enter' },
      { ...activate, action: 'fill', value: 'Preview' },
      { ...activate, action: 'select', value: 'Preview' },
    ];
    for (const step of unsupported) {
      const { report, events } = await run([step, check], true);
      assert.equal(report.status, 'abstained', JSON.stringify(report));
      assert.equal(report.steps.length, 1);
      assert.match(report.steps[0].message ?? '', /Native input was refused/);
      assert.deepEqual(events, []);
    }
  });
  await t.test('strict first target never falls back to another recorded selector', async () => {
    control = button.replace('id="preview"', 'id="other"');
    const click: Step = { ...activate, action: 'click', target: { ...target, selectors: ['#preview', 'text=Preview'] } };
    const { report, events } = await run([click, check], true);
    assert.equal(report.status, 'abstained', JSON.stringify(report));
    assert.match(report.steps[0].message ?? '', /Recorded ID is missing/);
    assert.deepEqual(events, []);
    control = button;
  });
  await t.test('checkbox activation changes checked state', async () => {
    control = '<label for="preview">Preview</label><input id="preview" type="checkbox">';
    const { report, events } = await run([
      { ...activate, target: { selectors: ['#preview'], evidence: { tag: 'input', type: 'checkbox', role: 'checkbox', name: 'Preview' } } },
      { id: 'check', action: 'assert', assertion: { kind: 'checked', target: { selectors: ['#preview'], evidence: { type: 'checkbox' } } } }
    ]);
    assert.equal(report.verified, true, JSON.stringify(report));
    assert.equal(await page.locator('#preview').isChecked(), true);
    assert.deepEqual(events, [{ type: 'click', trusted: false, id: 'preview' }]);
  });
  for (const [label, markup, pattern] of [
    ['absent', '', /missing or ambiguous/],
    ['duplicate ID', button + button, /missing or ambiguous/],
    ['different name', button.replace('Preview', 'Details'), /evidence did not match/],
    ['different control type', button.replace('type="button"', 'type="submit"'), /evidence did not match/],
    ['disabled', button.replace('<button ', '<button disabled '), /unavailable/],
    ['hidden', button.replace('<button ', '<button hidden '), /unavailable/],
    ['covered', button + '<div style="position:fixed;inset:0"></div>', /covered/],
    ['consequential visible text', button.replace('>Preview<', ' aria-label="Preview">Publish<'), /Consequential/],
  ] as const) {
    await t.test(label, async () => {
      control = markup;
      const { report, events } = await run([activate, check]);
      assert.equal(report.status, 'abstained', JSON.stringify(report));
      assert.equal(report.verified, false);
      assert.equal(report.steps.length, 1);
      assert.match(report.steps[0].message ?? '', pattern);
      assert.deepEqual(events, []);
      assert.equal(await page.locator('output').textContent(), 'Waiting');
    });
  }
});
