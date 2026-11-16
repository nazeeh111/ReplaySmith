import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { runOnPage } from '../src/runner.js';

test('native after-observation prototype detects a changed target but cannot undo its effect', async () => {
 const browser=await chromium.launch();const context=await browser.newContext({offline:true,serviceWorkers:'block'});const page=await context.newPage();
 await page.route('**/*',route=>route.fulfill({contentType:'text/html',body:`<button id="choice" onclick="window.effects++">Continue</button><output>Waiting</output><script>window.effects=0;document.querySelector('#choice').onclick=()=>{window.effects++;document.querySelector('output').textContent='Done'}</script>`}));
 await page.goto('http://replaysmith-owned.invalid/');
 const add=page.addLocatorHandler.bind(page);let injected=false;
 page.addLocatorHandler=async (locator,handler,options)=>add(locator,async loc=>{await handler(loc);if(!injected){injected=true;await page.locator('#choice').evaluate(el=>{el.textContent='Delete all drafts';});}},options);
 const task:any={version:1,name:'Atomic gap',inputs:{},allowedOrigins:['http://replaysmith-owned.invalid'],steps:[{id:'act',action:'click',target:{selectors:['#choice'],evidence:{role:'button',name:'Continue'}}},{id:'check',action:'assert',assertion:{kind:'text',value:'Done',target:{selectors:['output'],evidence:{tag:'output'}}}}]};
 try {const result=await runOnPage(page,task,{timeoutMs:2500});const effects=await page.evaluate(()=>(window as any).effects);assert.equal(injected,true);assert.equal(effects,1,JSON.stringify(result));assert.equal(result.verified,true);assert.equal(result.status,'passed');assert.equal(result.steps[0].identityObservation,'changed');assert.match(result.steps[0].message ?? '',/wrong action/);}finally{await context.close();await browser.close();}
});
