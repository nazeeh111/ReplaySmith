import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { chromium, type Browser } from 'playwright';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { runOnPage } from '../src/runner.js';
import { exportPlaywright, exportSkill } from '../src/exporter.js';
import { demoHtml, demoWorkflow } from '../src/demo.js';
import type { Workflow } from '../src/types.js';
let server:Server, foreign:Server, origin:string, foreignOrigin:string, browser:Browser;
let foreignRequests=0, destructivePosts=0;
let variant='original';
before(async () => {
  foreign=createServer((_req,res)=>{foreignRequests++;res.end('outside origin');});
  await new Promise<void>(resolve=>foreign.listen(0,'127.0.0.1',resolve));
  foreignOrigin=`http://127.0.0.1:${(foreign.address() as {port:number}).port}`;
  server=createServer((req,res)=>{
    if(req.url==='/destroy'){destructivePosts++;res.end('deleted');return;}
    if(variant==='form'){res.setHeader('Content-Type','text/html');res.end('<form aria-label="Delete account" action="/destroy" method="post"><label for="reason">Reason</label><input id="reason" name="reason"><button>Delete account</button></form>');return;}
    if(variant==='submit'){res.setHeader('Content-Type','text/html');res.end('<form action="/destroy" method="post"><button id="continue">Continue</button></form>');return;}
    if(variant==='nested-submit'){res.setHeader('Content-Type','text/html');res.end('<form action="/destroy" method="post"><button><span id="continue">Continue</span></button></form>');return;}
    if(variant==='private'){res.setHeader('Content-Type','text/html');res.end('<button>synthetic-secret-example</button><button>synthetic-secret-example</button>');return;}
    if(variant==='same-redirect'){res.writeHead(302,{Location:'/destination'});res.end();return;}
    if(variant==='redirect'){res.writeHead(302,{Location:foreignOrigin});res.end();return;}
    res.setHeader('Content-Type','text/html');
    const html=variant==='popup'?demoHtml('original').replace("window.fixtureState.saveCount++;",`window.open(${JSON.stringify(foreignOrigin)});window.fixtureState.saveCount++;`):demoHtml(variant);
    res.end(html);
  });
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
  origin=`http://127.0.0.1:${(server.address() as {port:number}).port}`;
  browser=await chromium.launch({headless:true});
});
after(async()=>{await browser?.close();await new Promise<void>(resolve=>server?.close(()=>resolve()));await new Promise<void>(resolve=>foreign?.close(()=>resolve()));});
async function run(kind:string, change?:(w:Workflow)=>void) {
  variant=kind;
  const page=await browser.newPage();
  const workflow=demoWorkflow(origin);change?.(workflow);
  try { const result=await runOnPage(page,workflow,{inputs:{note:'A separately chosen note.'},timeoutMs:900});return {result,state:await page.evaluate(()=> (window as any).fixtureState)}; } finally {await page.close();}
}
test('real browser executes original and changed IDs with independently checked state',async()=>{
  for(const kind of ['original','ids']) {
    const {result,state}=await run(kind);
    assert.equal(result.status,'passed',JSON.stringify(result));assert.equal(result.verified,true);assert.equal(state.saved,'A separately chosen note.');assert.equal(state.wrongActions,0);
  }
});
test('recycled destructive ID is never clicked and ambiguous candidates abstain',async()=>{
  const recycled=await run('reused-id');assert.equal(recycled.result.status,'passed',JSON.stringify(recycled.result));assert.equal(recycled.state.wrongActions,0);
  const ambiguous=await run('ambiguous');assert.equal(ambiguous.result.status,'abstained');assert.equal(ambiguous.state.saveCount,0);
});
test('disabled and missing controls take no action; wrong outcome fails verification',async()=>{
  for(const kind of ['missing','disabled']) {const {result,state}=await run(kind);assert.equal(result.status,'abstained',JSON.stringify(result));assert.equal(state.saveCount,0);}
  const wrong=await run('wrong-outcome');assert.equal(wrong.result.status,'failed');assert.equal(wrong.result.verified,false);
});
test('bounded resolution waits for hydration before acting',async()=>{const {result,state}=await run('delayed');assert.equal(result.status,'passed',JSON.stringify(result));assert.equal(state.saveCount,1);});
test('no final outcome check means unverified, even when actions pass',async()=>{const {result}=await run('original',w=>{w.steps.pop();});assert.equal(result.status,'passed');assert.equal(result.verified,false);});
test('sensitive action requires explicit permission, with no semantic recovery',async()=>{
  variant='original';const page=await browser.newPage();const workflow=demoWorkflow(origin);workflow.steps[2].sensitive=true;
  try{
    const blocked=await runOnPage(page,workflow,{timeoutMs:300});assert.equal(blocked.status,'abstained');assert.equal((await page.evaluate(()=> (window as any).fixtureState)).saveCount,0);
    variant='ids';const changed=await runOnPage(page,workflow,{timeoutMs:300,allowSensitive:true});assert.equal(changed.status,'abstained');assert.equal((await page.evaluate(()=> (window as any).fixtureState)).saveCount,0);
  }finally{await page.close();}
});
test('standalone Playwright and Agent Skill scripts execute with matching outcomes',async()=>{
  // Put inside the project so Node resolves its installed Playwright dependency.
  variant='ids';const folder=await mkdtemp(join(process.cwd(),'.export-test-'));
  const workflow=demoWorkflow(origin);
  try {
    for(const [name,code] of [['workflow.mjs',exportPlaywright(workflow)],['skill.mjs',exportSkill(workflow)['scripts/run.mjs']]]) {
      const path=join(folder,name);await writeFile(path,code);
      const result=await new Promise<{code:number|null;stdout:string;stderr:string}>(resolve=>{const child=spawn(process.execPath,[path,'--inputs',JSON.stringify({note:'From the standalone export'})],{cwd:folder});let stdout='',stderr='';child.stdout.on('data',b=>stdout+=b);child.stderr.on('data',b=>stderr+=b);child.on('exit',code=>resolve({code,stdout,stderr}));});
      assert.equal(result.code,0,result.stderr);const report=JSON.parse(result.stdout);assert.equal(report.status,'passed');assert.equal(report.verified,true);
    }
  }finally{await rm(folder,{recursive:true,force:true});}
});

test('cross-origin redirects and popup first navigations are blocked before foreign requests',async()=>{
  for(const kind of ['redirect','same-redirect','popup']) {
    foreignRequests=0;variant=kind;const page=await browser.newPage();
    try {const result=await runOnPage(page,demoWorkflow(origin),{timeoutMs:600});assert.equal(result.status,'failed',JSON.stringify(result));assert.equal(result.verified,false);}finally{await page.close();}
    assert.equal(foreignRequests,0,kind);
  }
});

test('Enter on an ordinary reason field inside a consequential form requires exact permission',async()=>{
  variant='form';destructivePosts=0;const page=await browser.newPage();
  const workflow:Workflow={version:1,name:'Form guard',inputs:{},allowedOrigins:[origin],steps:[{id:'open',action:'navigate',url:`${origin}/demo`},{id:'reason',action:'fill',target:{selectors:['#reason'],evidence:{role:'textbox',name:'Reason'}},value:'testing'},{id:'enter',action:'press',target:{selectors:['#reason'],evidence:{role:'textbox',name:'Reason'}},key:'Enter'}]};
  try{
    const result=await runOnPage(page,workflow,{timeoutMs:700});assert.equal(result.status,'abstained');assert.equal(destructivePosts,0);
    workflow.steps[2].target!.selectors=['#changed'];const recovered=await runOnPage(page,workflow,{timeoutMs:700,allowSensitive:true});assert.equal(recovered.status,'abstained');assert.equal(destructivePosts,0);
  }finally{await page.close();}
});
test('candidate evidence redacts declared secret input values',async()=>{
  variant='private';const page=await browser.newPage();
  const workflow:Workflow={version:1,name:'Private report',inputs:{secret:{secret:true}},allowedOrigins:[origin],steps:[{id:'open',action:'navigate',url:`${origin}/demo`},{id:'check',action:'assert',assertion:{kind:'visible',target:{selectors:['#missing'],evidence:{role:'button',name:'{{secret}}'}}}}]};
  try{const result=await runOnPage(page,workflow,{timeoutMs:600,inputs:{secret:'synthetic-secret-example'}});assert.equal(result.status,'abstained');assert.ok(!JSON.stringify(result).includes('synthetic-secret-example'));assert.match(JSON.stringify(result),/redacted/);}finally{await page.close();}
});

test('an implicitly submitting button with neutral text requires explicit permission',async()=>{
  variant='submit';destructivePosts=0;const page=await browser.newPage();
  const workflow:Workflow={version:1,name:'Implicit submit guard',inputs:{},allowedOrigins:[origin],steps:[{id:'open',action:'navigate',url:`${origin}/demo`},{id:'continue',action:'click',target:{selectors:['#continue'],evidence:{role:'button',name:'Continue'}}}]};
  try{const result=await runOnPage(page,workflow,{timeoutMs:600});assert.equal(result.status,'abstained');assert.equal(destructivePosts,0);}finally{await page.close();}
});

test('interpolated Enter and nested submit-control targets retain form guards',async()=>{
  for(const kind of ['form','nested-submit']){
    variant=kind;destructivePosts=0;const page=await browser.newPage();
    const key=kind==='form';
    const workflow:Workflow={version:1,name:'Submission guard regression',inputs:key?{key:{default:'Enter'}}:{},allowedOrigins:[origin],steps:[{id:'open',action:'navigate',url:`${origin}/demo`},key?{id:'enter',action:'press',key:'{{key}}',target:{selectors:['#reason'],evidence:{role:'textbox',name:'Reason'}}}:{id:'submit',action:'click',target:{selectors:['#continue'],evidence:{tag:'span',text:'Continue'}}}]};
    try{
      const result=await runOnPage(page,workflow,{timeoutMs:700});assert.equal(result.status,'abstained',kind);assert.equal(destructivePosts,0,kind);
      workflow.steps[1].target!.selectors=['#drifted'];
      const recovered=await runOnPage(page,workflow,{timeoutMs:700,allowSensitive:true});assert.equal(recovered.status,'abstained',kind);assert.equal(destructivePosts,0,kind);
    }finally{await page.close();}
  }
});
