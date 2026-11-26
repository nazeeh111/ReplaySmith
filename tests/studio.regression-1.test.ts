import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
import { startStudio } from '../src/server.js';
import type { Workflow } from '../src/types.js';

test('Studio cancels a pending run by keyboard without losing its workflow, then runs again', {timeout: 30000}, async () => {
  let effects=0, release=()=>{}, seen=()=>{};
  const gate=new Promise<void>(resolve=>{seen=resolve;});
  const fixture=createServer((req,res)=>{
    if(req.url==='/effect'){effects++;res.end('saved');return;}
    if(req.url==='/gate'){release=()=>res.end('ready');seen();return;}
    res.setHeader('Content-Type','text/html');res.end(`<button id="apply" onclick="fetch('/effect').then(()=>document.querySelector('#receipt').textContent='saved')">Apply</button><p id="receipt"></p><script>fetch('/gate').then(()=>{document.body.insertAdjacentHTML('beforeend','<p id="ready">ready</p>')})</script>`);
  });
  await new Promise<void>(resolve=>fixture.listen(0,'127.0.0.1',resolve));
  const origin=`http://127.0.0.1:${(fixture.address() as {port:number}).port}`;
  const workflow:Workflow={version:1,name:'A cancellable local run',inputs:{},allowedOrigins:[origin],steps:[
    {id:'open',action:'navigate',url:origin},
    {id:'wait',action:'assert',assertion:{kind:'visible',target:{selectors:['#ready'],evidence:{tag:'p',text:'ready'}}}},
    {id:'apply',action:'click',target:{selectors:['#apply'],evidence:{role:'button',name:'Apply'}}},
    {id:'receipt',action:'assert',assertion:{kind:'text',target:{selectors:['#receipt'],evidence:{tag:'p'}},value:'saved'}}]};
  const studio=await startStudio(0),browser=await chromium.launch({headless:true});
  const page=await browser.newPage({viewport:{width:process.env.REPLAYSMITH_PHONE === '1' ? 375 : 1440,height:1000},isMobile:process.env.REPLAYSMITH_PHONE === '1',hasTouch:process.env.REPLAYSMITH_PHONE === '1'});
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  const apply=async(w:Workflow)=>{await page.locator('#tab-source').click();await page.locator('#source-editor').fill(JSON.stringify(w,null,2));await page.locator('#apply-source-button').click();await page.getByText('Workflow source validated and applied.',{exact:false}).waitFor();};
  try{
    await page.goto(studio.origin);await page.locator('#workflow-name').waitFor();
    await page.waitForFunction(()=>!(document.getElementById('source-editor') as HTMLTextAreaElement).disabled);
    await apply(workflow);await page.locator('#run-button').click();await gate;
    if(process.env.REPLAYSMITH_REVIEW_SHOTS){await mkdir(process.env.REPLAYSMITH_REVIEW_SHOTS,{recursive:true});await page.screenshot({path:process.env.REPLAYSMITH_REVIEW_SHOTS+'/pending-desktop.png',fullPage:true});}
    const cancel=page.getByRole('button',{name:'Cancel run',exact:true});
    await cancel.waitFor({state:'visible',timeout:1500});await cancel.focus();await page.keyboard.press('Enter');
    await page.getByText('Run cancelled.',{exact:false}).waitFor();
    assert.equal(await page.locator('#workflow-name').inputValue(),workflow.name);
    assert.equal(await page.locator('#workflow-status').textContent(),'Cancelled');
    assert.equal(await page.locator('#run-button').isEnabled(),true);
    await new Promise(resolve=>setTimeout(resolve,250));release();await new Promise(resolve=>setTimeout(resolve,150));assert.equal(effects,0);
    if(process.env.REPLAYSMITH_REVIEW_SHOTS){await page.screenshot({path:process.env.REPLAYSMITH_REVIEW_SHOTS+'/cancelled-desktop.png',fullPage:true});await page.setViewportSize({width:375,height:812});await page.screenshot({path:process.env.REPLAYSMITH_REVIEW_SHOTS+'/cancelled-phone.png',fullPage:true});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);}
    await apply({...workflow,steps:workflow.steps.filter(s=>s.id!=='wait')});
    await page.locator('#tab-workflow').click();
    await page.getByRole('checkbox',{name:'Require a matching first target'}).uncheck();
    await page.locator('#run-button').click();await page.getByRole('heading',{name:'The outcome checks passed.',exact:true}).waitFor();
    assert.equal(await page.locator(':focus').getAttribute('id'), 'run-report-title');
    assert.equal(effects,1);assert.deepEqual(errors,[]);
  }finally{await browser.close();release();await studio.close();fixture.closeAllConnections();await new Promise<void>(resolve=>fixture.close(()=>resolve()));}
});
