import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { chromium } from 'playwright';
import { runOnPage } from '../src/runner.js';
import type { Workflow } from '../src/types.js';

test('recovery exhausts its operation budget before acting on a large candidate set', async (context) => {
  const server = createServer((_req, res) => {
    res.setHeader('Content-Type', 'text/html');
    res.end(`<script>window.actions=0</script>${Array.from({length: 1500}, (_, i) => `<button>Other candidate ${i}</button>`).join('')}<button onclick="window.actions++">Choose preferred draft now</button>`);
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${(server.address() as {port: number}).port}`;
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.goto(origin);
    const workflow: Workflow = {version: 1, name: 'Bounded recovery', inputs: {}, allowedOrigins: [origin], steps: [
      {id: 'choose', action: 'click', target: {selectors: ['#old-choice'], evidence: {role: 'button', name: 'Choose preferred draft'}}},
    ]};
    const result = await runOnPage(page, workflow, {timeoutMs: 100});
    context.diagnostic(`Recovery duration ${result.durationMs}ms with configured100ms; no browser-startup time included.`);
    assert.equal(result.status, 'abstained', JSON.stringify(result));
    assert.equal(await page.evaluate(() => (window as any).actions), 0);
    assert.match(result.steps[0].message ?? '', /budget|timed out/);
  } finally {
    await browser.close();
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});
