/** Opt-in live-site acceptance: harmless controls on the-internet.herokuapp.com.
 * Uses the installed build unchanged. Not part of deterministic/offline CI.
 * node scripts/live-internet.mjs [--out path] [--case dropdown|dynamic-controls|checkboxes|dynamic-loading]
 */
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {resolve,dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
import {chromium} from 'playwright';
import {recordWorkflow,prepareWorkflow,runOnPage,exportPlaywright,exportSkill,skillName} from '../dist/index.js';
const repo=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const args=process.argv.slice(2);
const arg=(key,fallback)=>{const i=args.indexOf(key);return i<0?fallback:args[i+1];};
const out=resolve(arg('--out',process.env.LIVE_OUT??join(repo,`artifacts/live-web/internet-${new Date().toISOString().replace(/[:.]/g,'-')}`)));
await mkdir(dirname(out),{recursive:true});await mkdir(out);
const site='https://the-internet.herokuapp.com';
const hash=async path=>createHash('sha256').update(await readFile(join(repo,path))).digest('hex');
const packageJson=JSON.parse(await readFile(join(repo,'package.json'),'utf8'));
const report={startedAt:new Date().toISOString(),site,version:packageJson.version,node:process.version,scope:'DOM-only public test controls; no login, credentials, account writes, uploads or messages',hashes:{},cases:[]};
for(const path of ['dist/evidence.js','dist/recorder.js','dist/runner.js','dist/prepare.js','dist/exporter.js','dist/recovery.js','package-lock.json']){
  try{report.hashes[path]=await hash(path);}catch(error){if(error.code!=='ENOENT')throw error;report.hashes[path]='not present in this build';}
}
const save=async(path,value)=>{await mkdir(dirname(path),{recursive:true});await writeFile(path,typeof value==='string'?value:JSON.stringify(value,null,2)+'\n');};
const stop=async page=>page.locator('#replaysmith-recorder').getByRole('button',{name:'Stop & review'}).click();
const assertText=async(page,target)=>{await page.locator('#replaysmith-recorder').getByRole('button',{name:'Assert text'}).click();await page.locator(target).click();};
const cases=[
  {name:'dropdown',path:'/dropdown',record:async page=>{await page.locator('#dropdown').selectOption('1');await assertText(page,'#dropdown');},improve:workflow=>{const input=Object.keys(workflow.inputs)[0];const check=workflow.steps.at(-1).assertion;check.kind='value';check.value=`{{${input}}}`;return{inputs:{[input]:'2'},note:'Improved native text assertion on a select to an explicit selected-value assertion, then changed Option 1 to Option 2. No target evidence edits.'};},oracle:async page=>({selected:await page.locator('#dropdown').inputValue()}),expected:state=>state.selected==='2'},
  {name:'dynamic-controls',path:'/dynamic_controls',record:async page=>{await page.locator('#input-example button').click();await page.locator('#input-example input').fill('recorded harmless value');await page.locator('#input-example #message').waitFor({state:'visible',timeout:12000});await assertText(page,'#input-example #message');},improve:workflow=>({inputs:{[Object.keys(workflow.inputs)[0]]:'changed harmless value'},note:'Changed the automatically prepared text input; retained native assertion that the input is enabled.'}),oracle:async page=>({enabled:await page.locator('#input-example input').isEnabled(),value:await page.locator('#input-example input').inputValue()}),expected:state=>state.enabled&&state.value==='changed harmless value'},
  {name:'checkboxes',path:'/checkboxes',record:async page=>{await page.locator('#checkboxes input').nth(0).check();},improve:workflow=>{workflow.steps.push({id:'verify-checked',action:'assert',description:'Verify the first checkbox is checked',assertion:{kind:'visible',target:{selectors:['#checkboxes input:nth-of-type(1):checked'],evidence:{}}}});return{inputs:{},note:'Improved the click-only native recording with an explicit visible :checked selector and no recovery evidence, then independently inspected checked state.'};},oracle:async page=>({firstChecked:await page.locator('#checkboxes input').nth(0).isChecked(),secondChecked:await page.locator('#checkboxes input').nth(1).isChecked()}),expected:state=>state.firstChecked===true&&state.secondChecked===true},
  {name:'dynamic-loading',path:'/dynamic_loading/2',record:async page=>{await page.locator('#start button').click();await page.locator('#finish h4').waitFor({state:'visible',timeout:15000});await assertText(page,'#finish h4');},improve:()=>({inputs:{},note:'Retained native delayed outcome text assertion.'}),oracle:async page=>({finishVisible:await page.locator('#finish h4').isVisible(),text:await page.locator('#finish h4').textContent()}),expected:state=>state.finishVisible&&state.text.trim()==='Hello World!'},
];
const selected=arg('--case');
if(selected&&!cases.some(c=>c.name===selected))throw new Error('Unknown live case: '+selected);
for(const scenario of cases.filter(c=>!selected||c.name===selected)){
  const folder=join(out,scenario.name);await mkdir(folder,{recursive:true});
  const item={name:scenario.name,url:site+scenario.path,startedAt:new Date().toISOString()};report.cases.push(item);
  try{
    const raw=await recordWorkflow(item.url,{headless:true,onReady:async context=>{const page=context.pages()[0];item.observed={title:await page.title(),url:page.url()};await scenario.record(page);await page.screenshot({path:join(folder,'recorded.png'),fullPage:true});await stop(page);}});
    raw.name=`Internet ${scenario.name}`;await save(join(folder,'recording.json'),raw);
    const workflow=prepareWorkflow(raw);const improved=scenario.improve(workflow);item.preparation=improved;await save(join(folder,'workflow.json'),workflow);
    const browser=await chromium.launch({headless:true});report.browserVersion=browser.version();
    try{
      const context=await browser.newContext({serviceWorkers:'block'});const page=await context.newPage();
      const result=await runOnPage(page,workflow,{inputs:improved.inputs,timeoutMs:15000});
      item.replay=result;await save(join(folder,'replay.json'),result);
      item.independentState=await scenario.oracle(page);item.independentOutcome=scenario.expected(item.independentState);await page.screenshot({path:join(folder,'replayed.png'),fullPage:true});
    }finally{await browser.close();}
    const code=exportPlaywright(workflow);const codePath=join(folder,'workflow.mjs');await save(codePath,code);
    const files=exportSkill(workflow);const skillFolder=join(folder,'skill',skillName(workflow));for(const [name,value]of Object.entries(files))await save(join(skillFolder,name),value);
    const execute=async(path,label)=>{
      const result=await new Promise(resolveProcess=>{const child=spawn(process.execPath,[path,'--timeout-ms','15000','--inputs',JSON.stringify(improved.inputs)],{cwd:repo,env:process.env});let stdout='',stderr='';const timeout=setTimeout(()=>child.kill('SIGTERM'),120000);child.stdout.on('data',b=>stdout+=b);child.stderr.on('data',b=>stderr+=b);child.on('close',(code,signal)=>{clearTimeout(timeout);resolveProcess({code,signal,stdout,stderr});});});
      let parsed;try{parsed=JSON.parse(result.stdout);}catch{}
      await save(join(folder,`${label}.json`),{...result,result:parsed});return{exitCode:result.code,signal:result.signal,result:parsed,error:result.stderr||undefined};
    };
    item.playwrightExport=await execute(codePath,'playwright-export');item.skillExport=await execute(join(skillFolder,'scripts/run.mjs'),'skill-export');
  }catch(error){item.error={name:error.name,message:error.message};}
  item.finishedAt=new Date().toISOString();await save(join(out,'report.json'),report);
  console.log(JSON.stringify({case:item.name,status:item.replay?.status,verified:item.replay?.verified,independentOutcome:item.independentOutcome,error:item.error}));
}
report.finishedAt=new Date().toISOString();await save(join(out,'report.json'),report);
console.log(`Evidence: ${join(out,'report.json')}`);

const failed=report.cases.some(item=>{const verified=true;return item.error||!item.independentOutcome||item.replay?.status!=='passed'||item.replay?.verified!==verified||[item.playwrightExport,item.skillExport].some(result=>result?.exitCode!==(verified?0:2)||result.result?.status!=='passed'||result.result?.verified!==verified);});
if(failed)process.exitCode=1;
