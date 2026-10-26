import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {recordWorkflow} from '../src/recorder.js';
import {runWorkflow} from '../src/runner.js';
import {validateWorkflow} from '../src/workflow.js';
import {demoHtml} from '../src/demo.js';
import {prepareWorkflow} from '../src/prepare.js';

test('real recorder demonstration captures inputs, action, assertion and replays with a new value',async()=>{
  const server=createServer((_req,res)=>{res.setHeader('Content-Type','text/html');res.end(demoHtml());});
  await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));
  const address=server.address();assert.ok(address&&typeof address==='object');
  const origin=`http://127.0.0.1:${address.port}`;
  try{
    const workflow=await recordWorkflow(origin,{headless:true,onReady:async context=>{
      const page=context.pages()[0];
      await page.getByLabel('Dispatch note').fill('A real demonstration');
      await page.getByRole('button',{name:'Save draft',exact:true}).click();
      await page.locator('#replaysmith-recorder').getByRole('button',{name:'Assert text'}).click();
      await page.locator('#receipt').click();
      await page.locator('#replaysmith-recorder').getByRole('button',{name:'Stop & review'}).click();
    }});
    validateWorkflow(workflow);
    assert.deepEqual(workflow.steps.map(s=>s.action),['navigate','fill','click','assert']);
    assert.equal(workflow.steps[1].value,'A real demonstration');
    assert.equal(workflow.steps[3].assertion?.value,'Draft saved: A real demonstration');
    const prepared=prepareWorkflow(workflow);
    const result=await runWorkflow(prepared,{timeoutMs:1000,inputs:{dispatch_note:'Changed after recording'}});
    assert.equal(result.status,'passed');assert.equal(result.verified,true);
  }finally{await new Promise<void>((resolve,reject)=>server.close(e=>e?reject(e):resolve()));}
});

test('password recorder never transmits or stores the typed password',async()=>{
  const server=createServer((_req,res)=>{res.setHeader('Content-Type','text/html');res.end('<label for="pw">Password</label><input id="pw" type="password"><button type="button">Continue</button>');});
  await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));const address=server.address();assert.ok(address&&typeof address==='object');
  try{
    const workflow=await recordWorkflow(`http://127.0.0.1:${address.port}`,{headless:true,onReady:async context=>{
      const page=context.pages()[0];await page.getByLabel('Password').fill('fixture-private-value');await page.getByRole('button',{name:'Continue',exact:true}).click();await page.locator('#replaysmith-recorder').getByRole('button',{name:'Stop & review'}).click();
    }});
    assert.equal(JSON.stringify(workflow).includes('fixture-private-value'),false);
    assert.equal(workflow.inputs.secret_1.secret,true);assert.equal(workflow.inputs.secret_1.default,undefined);validateWorkflow(workflow);
  }finally{await new Promise<void>((resolve,reject)=>server.close(e=>e?reject(e):resolve()));}
});

test('type then Enter records value before submission; number controls retain implicit role',async()=>{
  const server=createServer((_req,res)=>{res.setHeader('Content-Type','text/html');res.end('<form onsubmit="event.preventDefault();document.querySelector(\'output\').textContent=document.querySelector(\'input\').value"><label for="quantity">Quantity</label><input id="quantity" type="number"><output>Waiting</output></form>');});
  await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));const address=server.address();assert.ok(address&&typeof address==='object');
  try{
    const workflow=await recordWorkflow(`http://127.0.0.1:${address.port}`,{headless:true,onReady:async context=>{
      const page=context.pages()[0];const input=page.getByLabel('Quantity');await input.fill('42');await input.press('Enter');await page.locator('#replaysmith-recorder').getByRole('button',{name:'Assert text'}).click();await page.locator('output').click();await page.locator('#replaysmith-recorder').getByRole('button',{name:'Stop & review'}).click();
    }});
    validateWorkflow(workflow);assert.deepEqual(workflow.steps.map(s=>s.action),['navigate','fill','press','assert']);assert.equal(workflow.steps[1].target?.evidence.role,'spinbutton');
    const result=await runWorkflow(workflow,{timeoutMs:1000,allowSensitive:true});assert.equal(result.status,'passed');assert.equal(result.verified,true);
  }finally{await new Promise<void>((resolve,reject)=>server.close(e=>e?reject(e):resolve()));}
});
