import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request } from 'node:http';
import { startStudio } from '../src/server.js';
import type { Workflow } from '../src/types.js';

for (const cause of ['disconnect', 'shutdown'] as const) {
  test(`Studio ${cause} cancels pending resolution before a later native action`, { timeout: 20_000 }, async () => {
    let effects = 0;
    let release: () => void = () => {};
    let gateSeen: () => void = () => {};
    const gate = new Promise<void>(resolve => { gateSeen = resolve; });
    const fixture = createServer((req, res) => {
      if (req.url === '/effect') { effects++; res.end('saved'); return; }
      if (req.url === '/gate') { release = () => res.end('ready'); gateSeen(); return; }
      res.setHeader('Content-Type', 'text/html');
      res.end(`<button id="apply" onclick="fetch('/effect').then(()=>document.querySelector('#receipt').textContent='saved')">Apply</button><p id="receipt"></p><script>fetch('/gate').then(()=>{const p=document.createElement('p');p.id='ready';p.textContent='ready';document.body.append(p)})</script>`);
    });
    await new Promise<void>(resolve => fixture.listen(0, '127.0.0.1', resolve));
    const origin = `http://127.0.0.1:${(fixture.address() as { port: number }).port}`;
    const studio = await startStudio(0);
    const workflow: Workflow = { version: 1, name: 'Cancellation fixture', inputs: {}, allowedOrigins: [origin], steps: [
      { id: 'open', action: 'navigate', url: origin },
      { id: 'wait', action: 'assert', assertion: { kind: 'visible', target: { selectors: ['#ready'], evidence: { tag: 'p', text: 'ready' } } } },
      { id: 'apply', action: 'click', target: { selectors: ['#apply'], evidence: { role: 'button', name: 'Apply' } } },
      { id: 'receipt', action: 'assert', assertion: { kind: 'text', target: { selectors: ['#receipt'], evidence: { tag: 'p' } }, value: 'saved' } },
    ] };
    let req: ReturnType<typeof request> | undefined;
    let closing: Promise<void> | undefined;
    let result: Promise<{ status: number; body: any }> | undefined;
    try {
      result = new Promise((resolve, reject) => {
        req = request(`${studio.origin}/api/run`, { method: 'POST', headers: { 'Content-Type': 'application/json' } }, res => {
          let body = ''; res.on('data', chunk => { body += chunk; });
          res.on('end', () => resolve({ status: res.statusCode!, body: JSON.parse(body) }));
        });
        req.on('error', error => cause === 'disconnect' ? resolve({ status: 0, body: null }) : reject(error));
        req.end(JSON.stringify({ workflow }));
      });
      await gate;
      if (cause === 'disconnect') {
        await new Promise<void>(resolve => { req!.once('close', resolve); req!.destroy(); });
        await result;
      } else { closing = studio.close(); }
      // Let the server observe transport closure before making the pending target available.
      await new Promise(resolve => setTimeout(resolve, 150));
      release();
      if (cause === 'shutdown') {
        const response = await result;
        assert.equal(response.status, 200);
        assert.equal(response.body.verified, false);
        assert.notEqual(response.body.status, 'passed');
        assert.equal(response.body.steps.some((step: any) => step.id === 'apply'), false);
        await closing;
      } else {
        // Wait for actual cleanup rather than requiring a fixed browser-close duration.
        const simple: Workflow = { ...workflow, steps: [workflow.steps[0]!, workflow.steps[2]!, workflow.steps[3]!] };
        let response: Response | undefined;
        for (let attempt = 0; attempt < 40; attempt++) {
          response = await fetch(`${studio.origin}/api/run`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ workflow: simple }) });
          if (response.status !== 409) break;
          await response.json();
          await new Promise(resolve => setTimeout(resolve, 100));
        }
        assert.equal(response?.status, 200);
        const body = await response!.json() as { status: string; verified: boolean };
        assert.equal(body.status, 'passed'); assert.equal(body.verified, true);
      }
      assert.equal(effects, cause === 'disconnect' ? 1 : 0, 'cancelled run must not perform the later click; only the new connected run may save');
    } finally {
      req?.destroy(); release();
      studio.server.closeAllConnections(); await (closing ?? studio.close());
      fixture.closeAllConnections(); await new Promise<void>(resolve => fixture.close(() => resolve()));
    }
  });
}
