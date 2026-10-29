import test, {before, after} from 'node:test';
import assert from 'node:assert/strict';
import {createServer, type Server} from 'node:http';
import {mkdtemp,mkdir,writeFile,symlink,rm} from 'node:fs/promises';
import {join,dirname,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {spawn} from 'node:child_process';
import {chromium,type Browser} from 'playwright';
import {recordWorkflow} from '../src/recorder.js';
import {prepareWorkflow} from '../src/prepare.js';
import {runOnPage} from '../src/runner.js';
import {exportPlaywright,exportSkill,skillName} from '../src/exporter.js';
import {elementEvidenceScript} from '../src/evidence.js';
import type {Workflow} from '../src/types.js';

let server:Server,browser:Browser,origin:string;
let headingShell='record';
let strictDrift=false;
const settings=`<!doctype html><section><div><h2>Profile settings</h2></div>
<select id="dropdown"><option value="first-choice">Option 1</option><option value="second-choice">Option 2</option></select>
<input id="destination" placeholder="Destination"><span id="reference-label">Reference note</span><input id="reference" aria-labelledby="reference-label">
<button id="enable" type="button">Enable</button><input id="dynamic" type="text" disabled>
<button id="save" type="button">Save draft</button><output id="receipt">Waiting</output></section>
<script>window.state={enableCount:0,saveCount:0};document.querySelector('#enable').onclick=()=>{state.enableCount++;setTimeout(()=>document.querySelector('#dynamic').disabled=false,180);};document.querySelector('#save').onclick=()=>{state.saveCount++;document.querySelector('#receipt').textContent='Saved: '+['dropdown','destination','reference','dynamic'].map(id=>document.getElementById(id).value).join(' | ')+' | enables='+state.enableCount+' | saves='+state.saveCount;const permalink=document.createElement('span');permalink.hidden=true;permalink.textContent='¶';document.querySelector('#receipt').append(permalink);};</script>`;
before(async()=>{
  server=createServer((req,res)=>{
    res.setHeader('Content-Type','text/html');
    if(req.url==='/picker'){res.end('<form onsubmit="event.preventDefault();window.submissions++"><button id="outcome" type="submit"><span id="heading">Exact outcome</span></button></form><script>window.replacements=0;window.submissions=0;window.addEventListener("mousedown",event=>{if(event.target.closest("#outcome")){window.replacements++;document.querySelector("#heading").outerHTML="<span id=heading>Replaced after press</span>";}},true);</script>');return;}
    if(req.url==='/heading-start'){res.end('<nav><a href="/heading-docs">Locators</a></nav>');return;}
    if(req.url==='/heading-docs'){
      const headings=headingShell==='wrong-level'?'<h2>Locators</h2>':headingShell==='ambiguous'?'<h1>Locators</h1><h1>Locators</h1>':'<h1>Locators</h1>';
      res.end('<main><article>'+(headingShell==='record'?'<div>'+headings+'</div>':'<section><header>'+headings+'</header></section>')+'<h2>Methods</h2><h3>Details</h3></article></main>');return;
    }
    if(req.url==='/large-pool'){res.end('<button onclick="window.wrong++">Continue</button>'+Array.from({length:1200},(_,index)=>'<button onclick="window.wrong++">Other '+index+'</button>').join('')+'<button onclick="window.wrong++">Continue</button><script>window.wrong=0</script>');return;}
    if(req.url==='/window-capture.js'){res.setHeader('Content-Type','application/javascript');res.end(settings.match(/<script>([\s\S]*)<\/script>/)![1]+`;window.addEventListener('click',event=>{if(event.target instanceof Element&&event.target.closest('#receipt'))event.stopPropagation();},true);`);return;}
    if(req.url==='/window-capture'){res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'");res.end(settings.replace(/<script>[\s\S]*<\/script>/,'<script src="/window-capture.js"></script>'));return;}
    if(req.url==='/strict.js'){res.setHeader('Content-Type','application/javascript');res.end(settings.match(/<script>([\s\S]*)<\/script>/)![1]+(strictDrift?";document.querySelector('#save').textContent='Save draft now';":''));return;}
    if(req.url==='/strict'){res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'");res.end(settings.replace(/<script>[\s\S]*<\/script>/,'<script src="/strict.js"></script>'));return;}
    if(req.url==='/permanent'){res.end('<input id="waiting" disabled><output>Unchanged</output>');return;}
    if(req.url==='/replacement'){res.end('<button id="waiting" type="button" disabled>Continue</button><script>window.wrong=0;setTimeout(()=>{document.querySelector("button").outerHTML=\'<button id="waiting" type="button" onclick="window.wrong++">Delete all drafts</button>\'},150)</script>');return;}
    if(req.url==='/submit'){res.end('<form onsubmit="event.preventDefault();window.wrong++"><button id="waiting" type="button" disabled>Continue</button></form><script>window.wrong=0;setTimeout(()=>{const button=document.querySelector("button");button.type="submit";button.disabled=false;},150)</script>');return;}
    res.end(settings);
  });
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
  origin=`http://127.0.0.1:${(server.address() as {port:number}).port}`;
  browser=await chromium.launch();
});
after(async()=>{await browser?.close();server?.closeAllConnections();await new Promise<void>(resolve=>server?.close(()=>resolve()));});

let recorded:Workflow;
async function capture(path='/settings'){
  if(recorded&&path==='/settings')return recorded;
  const captured=await recordWorkflow(origin+path,{headless:true,onReady:async context=>{
    const page=context.pages()[0];
    await page.locator('#dropdown').selectOption('first-choice');
    // Native select emits change only when its value changes.
    await page.locator('#dropdown').selectOption('second-choice');
    await page.locator('#destination').fill('Original destination');
    await page.locator('#reference').fill('Original reference');
    await page.locator('#enable').click();
    await page.locator('#dynamic').fill('Original dynamic value');
    await page.locator('#save').click();
    await page.locator('#replaysmith-recorder').getByRole('button',{name:'Assert text'}).click();
    await page.locator('#receipt').click();
    await page.locator('#replaysmith-recorder').getByRole('button',{name:'Stop & review'}).click();
  }});
  if(path==='/settings')recorded=captured;
  return captured;
}
function changedInputs(workflow:Workflow){
  return Object.fromEntries(Object.entries(workflow.inputs).map(([key,spec])=>[key,spec.default==='second-choice'?'first-choice':`Changed ${spec.default}`]));
}
test('native recording shares semantic evidence with replay and waits for asynchronously enabled fields',async()=>{
  const raw=await capture();
  const select=raw.steps.find(s=>s.action==='select')!;
  assert.equal(select.target!.evidence.name,undefined,'an unnamed select does not acquire its option list as a name');
  assert.equal(select.target!.evidence.context,'Profile settings','nested heading supplies the same context at capture and replay');
  const destination=raw.steps.find(s=>s.target?.selectors.includes('#destination'))!;
  assert.equal(destination.target!.evidence.type,'text');assert.equal(destination.target!.evidence.name,'Destination');
  const reference=raw.steps.find(s=>s.target?.selectors.includes('#reference'))!;assert.equal(reference.target!.evidence.name,'Reference note');
  assert.match(raw.steps.at(-1)!.assertion!.value!,/¶$/,'native assertion records DOM text including hidden permalink markers');
  const workflow=prepareWorkflow(raw),inputs=changedInputs(workflow);
  workflow.steps.find(step=>step.target?.selectors.includes('#save'))!.target!.selectors=['#retired-save'];strictDrift=true;
  const page=await browser.newPage();
  try{
    const result=await runOnPage(page,workflow,{inputs,timeoutMs:2000});
    assert.equal(result.status,'passed',JSON.stringify(result));assert.equal(result.verified,true);
    assert.equal(await page.locator('#dropdown').inputValue(),'first-choice');
    assert.ok(!(await page.locator('#receipt').innerText()).includes('¶'),'visible text differs from the deliberately consistent DOM-text assertion');
    assert.deepEqual(await page.evaluate(()=> (window as any).state),{enableCount:1,saveCount:1},'waiting must never repeat actions');
    for(const [key,spec]of Object.entries(workflow.inputs))assert.notEqual(inputs[key],spec.default);
  }finally{await page.close();}
});

test('both actual exported scripts retain shared evidence, changed inputs and asynchronous readiness',async()=>{
  const workflow=prepareWorkflow(await capture()),inputs=changedInputs(workflow);
  const folder=await mkdtemp(join(tmpdir(),'replaysmith-live-regression-'));
  try{
    await symlink(resolve('node_modules'),join(folder,'node_modules'),'dir');
    const codePath=join(folder,'workflow.mjs');await writeFile(codePath,exportPlaywright(workflow));
    const skill=join(folder,skillName(workflow));
    for(const [name,value]of Object.entries(exportSkill(workflow))){const file=join(skill,name);await mkdir(dirname(file),{recursive:true});await writeFile(file,value);}
    for(const file of [codePath,join(skill,'scripts/run.mjs')]){
      for(const timeout of (file===codePath?['2000','99']:['2000'])){
      const result=await new Promise<{code:number|null;stdout:string;stderr:string}>((resolveProcess,reject)=>{
        const child=spawn(process.execPath,[file,'--inputs',JSON.stringify(inputs),'--timeout-ms',timeout],{cwd:folder});let stdout='',stderr='';
        child.stdout.on('data',chunk=>stdout+=chunk);child.stderr.on('data',chunk=>stderr+=chunk);child.on('error',reject);child.on('close',code=>resolveProcess({code,stdout,stderr}));
      });
      if(timeout==='2000'){
        assert.equal(result.code,0,result.stderr+result.stdout);const report=JSON.parse(result.stdout);assert.equal(report.verified,true);assert.equal(report.status,'passed');
      }else{
        assert.equal(result.code,1,result.stderr+result.stdout);assert.match(result.stderr,/--timeout-ms must be an integer from 100 to 60000/);assert.equal(result.stdout,'');
      }
      }
    }
  }finally{await rm(folder,{recursive:true,force:true});}
});

test('permanent disabled controls abstain and target replacement during waiting takes no action',async()=>{
  for(const path of ['/permanent','/replacement']){
    const page=await browser.newPage();
    const workflow:Workflow={version:1,name:'Readiness guard',inputs:{},allowedOrigins:[origin],steps:[{id:'open',action:'navigate',url:origin+path},path==='/permanent'?{id:'act',action:'fill',target:{selectors:['#waiting'],evidence:{tag:'input',role:'textbox',type:'text'}},value:'must not be entered'}:{id:'act',action:'click',target:{selectors:['#waiting'],evidence:{tag:'button',role:'button',type:'button',name:'Continue'}}}]};
    try{
      const result=await runOnPage(page,workflow,{timeoutMs:600});assert.equal(result.status,'abstained',JSON.stringify(result));
      if(path==='/permanent')assert.equal(await page.locator('#waiting').inputValue(),'');else assert.equal(await page.evaluate(()=> (window as any).wrong),0);
    }finally{await page.close();}
  }
});

test('readiness waits still recheck form-submission permission immediately before acting',async()=>{
  const page=await browser.newPage();
  const workflow:Workflow={version:1,name:'Delayed submit guard',inputs:{},allowedOrigins:[origin],steps:[{id:'open',action:'navigate',url:origin+'/submit'},{id:'act',action:'click',target:{selectors:['#waiting'],evidence:{tag:'button',role:'button',name:'Continue'}}}]};
  try{const result=await runOnPage(page,workflow,{timeoutMs:1000});assert.equal(result.status,'abstained');assert.equal(await page.evaluate(()=> (window as any).wrong),0);}finally{await page.close();}
});

test('shared extraction keeps normal defaults, ARIA references and labels without collecting text input values',async()=>{
  const page=await browser.newPage();
  try{
    await page.setContent('<section><div><h2>Nested context</h2></div><button id="plain">Continue</button><input id="number" type="number" value="314159"><label for="q">Query</label><input id="q"><span id="from">From</span><span id="place">Location</span><input id="aria" aria-labelledby="from place"><select id="select"><option>First</option></select><textarea id="initial-value">314159</textarea></section>');
    const read=async(selector:string)=>page.locator(selector).evaluate(new Function('el',elementEvidenceScript) as (el:Element)=>Record<string,string>);
    assert.equal((await read('#plain')).type,'submit');
    assert.equal((await read('#aria')).name,'From Location');assert.equal((await read('#q')).label,'Query');
    const number=await read('#number');assert.equal(number.role,'spinbutton');assert.ok(!JSON.stringify(number).includes('314159'));
    assert.ok(!JSON.stringify(await read('#initial-value')).includes('314159'));
    assert.equal((await read('#select')).name,undefined);assert.equal((await read('#select')).context,'Nested context');
  }finally{await page.close();}
});

test('strict CSP permits native capture, changed-input replay and both actual exports without unsafe-eval',async()=>{
  strictDrift=false;
  const raw=await capture('/strict');
  assert.deepEqual(raw.steps.map(step=>step.action),['navigate','select','fill','fill','click','fill','click','assert']);
  const workflow=prepareWorkflow(raw),inputs=changedInputs(workflow);
  workflow.steps.find(step=>step.target?.selectors.includes('#save'))!.target!.selectors=['#retired-save'];strictDrift=true;
  const page=await browser.newPage();
  try{
    const result=await runOnPage(page,workflow,{inputs,timeoutMs:2000});assert.equal(result.status,'passed',JSON.stringify(result));assert.equal(result.verified,true);
    assert.deepEqual(await page.evaluate(()=> (window as any).state),{enableCount:1,saveCount:1});
    assert.ok(result.steps.some(step=>step.strategy==='recovery'),'strict CSP also exercises complete-pool recovery');
  }finally{await page.close();}
  const folder=await mkdtemp(join(tmpdir(),'replaysmith-csp-regression-'));
  try{
    await symlink(resolve('node_modules'),join(folder,'node_modules'),'dir');
    const files={'workflow.mjs':exportPlaywright(workflow),...Object.fromEntries(Object.entries(exportSkill(workflow)).map(([name,value])=>['skill/'+name,value]))};
    for(const [name,value]of Object.entries(files)){const file=join(folder,name);await mkdir(dirname(file),{recursive:true});await writeFile(file,value);}
    for(const file of [join(folder,'workflow.mjs'),join(folder,'skill/scripts/run.mjs')]){
      const result=await new Promise<{code:number|null;stdout:string;stderr:string}>((resolveProcess,reject)=>{
        const child=spawn(process.execPath,[file,'--inputs',JSON.stringify(inputs)],{cwd:folder});let stdout='',stderr='';child.stdout.on('data',chunk=>stdout+=chunk);child.stderr.on('data',chunk=>stderr+=chunk);child.on('error',reject);child.on('close',code=>resolveProcess({code,stdout,stderr}));
      });
      assert.equal(result.code,0,result.stderr+result.stdout);const report=JSON.parse(result.stdout);assert.equal(report.verified,true);assert.ok(report.steps.some((step:any)=>step.strategy==='recovery'));
    }
  }finally{strictDrift=false;await rm(folder,{recursive:true,force:true});}
});

test('native outcome capture survives a site window listener that stops clicks before document',async()=>{
  const diagnostic=await browser.newPage();
  try{
    await diagnostic.goto(origin+'/window-capture');
    await diagnostic.evaluate(()=>{(window as any).documentClicks=0;document.addEventListener('click',()=>{(window as any).documentClicks++;},true);});
    await diagnostic.locator('#receipt').click();
    assert.equal(await diagnostic.evaluate(()=> (window as any).documentClicks),0,'fixture must actually intercept before document');
  }finally{await diagnostic.close();}
  const raw=await capture('/window-capture');
  assert.deepEqual(raw.steps.map(step=>step.action),['navigate','select','fill','fill','click','fill','click','assert']);
  assert.match(raw.steps.at(-1)!.assertion!.value!,/^Saved:/);
  const workflow=prepareWorkflow(raw),page=await browser.newPage();
  try{const result=await runOnPage(page,workflow,{inputs:changedInputs(workflow),timeoutMs:2000});assert.equal(result.status,'passed',JSON.stringify(result));assert.equal(result.verified,true);}finally{await page.close();}
});

test('assertion picker captures before mouse-driven target replacement and drains rapid Stop',async()=>{
  const diagnostic=await browser.newPage();
  try{await diagnostic.goto(origin+'/picker');await diagnostic.locator('#heading').click();assert.equal(await diagnostic.evaluate(()=> (window as any).replacements),1,'fixture really changes target during the mouse gesture');}finally{await diagnostic.close();}
  for(const mode of ['pointer','synthetic']){
    const raw=await recordWorkflow(origin+'/picker',{headless:true,onReady:async context=>{
      const page=context.pages()[0];
      await page.evaluate(()=>{
        const original=(window as any).__replaysmithCapture;
        (window as any).__replaysmithCapture=(payload:any)=>payload.action==='assert'?new Promise(resolve=>setTimeout(()=>original(payload).then(resolve),180)):original(payload);
      });
      await page.locator('#replaysmith-recorder').getByRole('button',{name:'Assert text'}).click();
      if(mode==='pointer')await page.locator('#heading').click();else await page.locator('#heading').evaluate(el=>(el as HTMLElement).click());
      assert.equal(await page.evaluate(()=> (window as any).replacements),0);assert.equal(await page.evaluate(()=> (window as any).submissions),0);
      // Immediate Stop must preserve the acknowledgement-delayed capture.
      await page.locator('#replaysmith-recorder').getByRole('button',{name:'Stop & review'}).click();
    }});
    assert.deepEqual(raw.steps.map(step=>step.action),['navigate','assert']);assert.equal(raw.steps[1].assertion!.value,'Exact outcome');assert.deepEqual(raw.steps[1].assertion!.target!.selectors,['#heading']);
  }
});

test('picking without a subsequent click cannot swallow the next pointer gesture',async()=>{
  const raw=await recordWorkflow(origin+'/settings',{headless:true,onReady:async context=>{
    const page=context.pages()[0];await page.locator('#replaysmith-recorder').getByRole('button',{name:'Assert text'}).click();
    await page.locator('#receipt').dispatchEvent('pointerdown',{button:0,pointerId:91});
    await page.locator('#replaysmith-recorder #status').getByText('Outcome captured',{exact:true}).waitFor();
    await page.locator('#enable').click();
    await page.locator('#replaysmith-recorder').getByRole('button',{name:'Stop & review'}).click();
  }});
  assert.deepEqual(raw.steps.map(step=>step.action),['navigate','assert','click']);assert.deepEqual(raw.steps[2].target!.selectors,['#enable']);
});

test('Stop drains an earlier pending capture even when a later capture rejects',async()=>{
  let stopSawAcknowledgement:boolean|undefined;
  const raw=await recordWorkflow(origin+'/settings',{headless:true,onReady:async context=>{
    const page=context.pages()[0];
    await context.exposeBinding('__replaysmithDrainProbe',(_,acknowledged:boolean)=>{stopSawAcknowledgement=acknowledged;});
    await page.evaluate(()=>{
      const original=(window as any).__replaysmithCapture;
      let assertionAcknowledged=false;
      (window as any).__replaysmithCapture=(payload:any)=>{
        if(payload.action==='assert')return new Promise<void>(resolve=>setTimeout(()=>original(payload).then(()=>{assertionAcknowledged=true;resolve();}),180));
        if(payload.action==='click'&&payload.selector==='#enable')return Promise.reject(new Error('Fixture capture rejection'));
        if(payload.command==='stop')return (window as any).__replaysmithDrainProbe(assertionAcknowledged).then(()=>original(payload));
        return original(payload);
      };
      const controls=document.querySelector('#replaysmith-recorder')!.shadowRoot!;
      // One synchronous gesture sequence ensures Stop precedes the delayed acknowledgement.
      (controls.querySelector('#assert') as HTMLButtonElement).click();
      (document.querySelector('#receipt') as HTMLElement).click();
      (document.querySelector('#enable') as HTMLButtonElement).click();
      (controls.querySelector('#stop') as HTMLButtonElement).click();
    });
  }});
  assert.equal(stopSawAcknowledgement,true,'Stop must be dispatched only after every earlier capture acknowledges');
  assert.deepEqual(raw.steps.map(step=>step.action),['navigate','assert']);
  assert.equal(raw.steps[1].assertion!.value,'Waiting');
});

test('a bare heading level waits for its exact target instead of verifying an unrelated heading',async()=>{
  const page=await browser.newPage();
  const workflow:Workflow={version:1,name:'Delayed heading identity',inputs:{},allowedOrigins:[origin],steps:[{id:'outcome',action:'assert',assertion:{kind:'text',target:{selectors:['#actual'],evidence:{tag:'h4',role:'heading'}},value:'Hello World!'}}]};
  try{
    await page.goto(origin+'/settings');
    await page.setContent('<h4 id="unrelated">Hello World!</h4>');
    // Hold the expected result back so an unrelated heading cannot produce a false pass.
    const pending=await runOnPage(page,workflow,{timeoutMs:200});
    assert.equal(pending.status,'abstained',JSON.stringify(pending));assert.equal(pending.verified,false);assert.equal(await page.locator('#actual').count(),0);
    await page.evaluate(()=>setTimeout(()=>{const heading=document.createElement('h4');heading.id='actual';heading.textContent='Hello World!';document.body.append(heading);},180));
    const result=await runOnPage(page,workflow,{timeoutMs:1500});
    assert.equal(result.status,'passed',JSON.stringify(result));assert.equal(result.verified,true);assert.equal(result.steps[0].strategy,'selector');
    assert.equal(await page.locator('#actual').textContent(),'Hello World!');assert.equal(await page.locator('#unrelated').count(),1);
  }finally{await page.close();}
});

test('native heading levels survive SSR-to-client wrapper changes in replay and both exports',async()=>{
  headingShell='record';
  const raw=await recordWorkflow(origin+'/heading-start',{headless:true,onReady:async context=>{const page=context.pages()[0];await page.getByRole('link',{name:'Locators',exact:true}).click();await page.locator('#replaysmith-recorder').getByRole('button',{name:'Assert text'}).click();await page.locator('h1').click();await page.locator('#replaysmith-recorder').getByRole('button',{name:'Stop & review'}).click();}});
  const workflow=prepareWorkflow(raw);assert.equal(workflow.steps.at(-1)!.assertion!.target!.evidence.tag,'h1');assert.equal(workflow.steps.at(-1)!.assertion!.target!.evidence.name,undefined);
  headingShell='client';
  const page=await browser.newPage();
  try{const result=await runOnPage(page,workflow,{timeoutMs:1200});assert.equal(result.status,'passed',JSON.stringify(result));assert.equal(result.verified,true);assert.equal(result.steps.at(-1)!.strategy,'semantic');}finally{await page.close();}
  const folder=await mkdtemp(join(tmpdir(),'replaysmith-heading-regression-'));
  try{
    await symlink(resolve('node_modules'),join(folder,'node_modules'),'dir');
    const files={'workflow.mjs':exportPlaywright(workflow),'skill.mjs':exportSkill(workflow)['scripts/run.mjs']};
    for(const [name,content]of Object.entries(files)){const file=join(folder,name);await writeFile(file,content);const result=await new Promise<{code:number|null;stdout:string;stderr:string}>((resolveProcess,reject)=>{const child=spawn(process.execPath,[file],{cwd:folder});let stdout='',stderr='';child.stdout.on('data',chunk=>stdout+=chunk);child.stderr.on('data',chunk=>stderr+=chunk);child.on('error',reject);child.on('close',code=>resolveProcess({code,stdout,stderr}));});assert.equal(result.code,0,result.stderr+result.stdout);assert.equal(JSON.parse(result.stdout).verified,true);}
  }finally{await rm(folder,{recursive:true,force:true});}
  for(const variant of ['wrong-level','ambiguous']){headingShell=variant;const page=await browser.newPage();try{const result=await runOnPage(page,workflow,{timeoutMs:600});assert.equal(result.status,'abstained',JSON.stringify(result));assert.equal(result.verified,false);}finally{await page.close();}}
});

test('recovery abstains when its time budget cannot inspect a complete candidate pool',async()=>{
  const page=await browser.newPage();const workflow:Workflow={version:1,name:'Bounded inspection',inputs:{},allowedOrigins:[origin],steps:[{id:'act',action:'click',target:{selectors:['#missing'],evidence:{role:'button',name:'Continue'}}}]};
  try{
    await page.goto(origin+'/large-pool');
    // Force evidence extraction itself past the deadline even when batching makes
    // the 1,202-candidate scan fast. The semantic name lookup does not read test IDs.
    await page.locator('button').nth(1).evaluate(button=>{
      const readAttribute=button.getAttribute;let delayed=false;
      button.getAttribute=function(name:string){
        if(name==='data-testid'&&!delayed){delayed=true;const until=performance.now()+150;while(performance.now()<until){/* controlled evidence delay */}}
        return readAttribute.call(this,name);
      };
    });
    const result=await runOnPage(page,workflow,{timeoutMs:100});assert.equal(result.status,'abstained');assert.match(result.steps.at(-1)!.message!,/time budget/);assert.equal(await page.evaluate(()=> (window as any).wrong),0);
  }finally{await page.close();}
});
