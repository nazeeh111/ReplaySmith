import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, symlink, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { exportPlaywright, exportSkill } from '../src/exporter.js';

test('both exported runtimes stop later actions after changed identity', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'replaysmith-barrier-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await symlink(resolve('node_modules'), join(dir, 'node_modules'), 'dir');
  const pre = join(dir, 'fixture.mjs');
  await writeFile(pre, `import {chromium} from ${JSON.stringify(new URL('../node_modules/playwright/index.mjs', import.meta.url).href)};
const launch=chromium.launch.bind(chromium);chromium.launch=async o=>{const b=await launch({...o,executablePath:process.env.REPLAYSMITH_TEST_CHROMIUM,args:['--disable-background-networking']}),nc=b.newContext.bind(b);let p;b.newContext=async o=>{const c=await nc({...o,offline:true,serviceWorkers:'block'});await c.routeWebSocket('**/*',w=>w.close());const np=c.newPage.bind(c);c.newPage=async()=>{p=await np();await p.route('**/*',r=>r.fulfill({contentType:'text/html',body:'<button id="first" onclick="window.effects++">Continue</button><button id="later" onclick="window.later++">Next</button><script>window.effects=0;window.later=0</script>'}));const add=p.addLocatorHandler.bind(p);let changed=false;p.addLocatorHandler=async(l,h,o)=>add(l,async x=>{await h(x);if(!changed){changed=true;await p.locator('#first').evaluate(e=>e.textContent='Delete all drafts')}},o);return p};return c};const close=b.close.bind(b);b.close=async()=>{console.error('COUNTS:'+JSON.stringify(await p.evaluate(()=>({effects:window.effects,later:window.later}))));await close()};return b};`);
  const task:any = { version: 1, name: 'barrier export', inputs: {}, allowedOrigins: ['http://replaysmith-owned.invalid'], steps: [
    { id: 'open', action: 'navigate', url: 'http://replaysmith-owned.invalid' },
    { id: 'first', action: 'click', target: { selectors: ['#first'], evidence: { role: 'button', name: 'Continue' } } },
    { id: 'later', action: 'click', target: { selectors: ['#later'], evidence: { role: 'button', name: 'Next' } } },
  ] };
  for (const [name, code] of [['workflow.mjs', exportPlaywright(task)], ['skill.mjs', exportSkill(task)['scripts/run.mjs']]]) {
    const file = join(dir, name); await writeFile(file, code);
    const result = await new Promise<{ code: number | null; out: string; err: string }>((done, reject) => {
      const child = spawn(process.execPath, [file], { cwd: dir, env: { ...process.env, NODE_OPTIONS: `--import=${pre}` } });
      let out = '', err = ''; child.stdout.on('data', x => out += x); child.stderr.on('data', x => err += x); child.on('error', reject); child.on('close', code => done({ code, out, err }));
    });
    assert.equal(result.code, 2, result.err + result.out);
    const report = JSON.parse(result.out); assert.equal(report.status, 'abstained'); assert.equal(report.verified, false); assert.equal(report.steps[1].identityObservation, 'changed'); assert.equal(report.steps[2].status, 'abstained'); assert.match(result.err, /COUNTS:\{"effects":1,"later":0\}/);
  }
});
