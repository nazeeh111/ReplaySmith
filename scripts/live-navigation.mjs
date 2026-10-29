// Opt-in, read-only navigation on public documentation and a practice catalogue.
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {join,resolve,dirname} from 'node:path';
import {pathToFileURL} from 'node:url';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {chromium} from 'playwright';
import {createHash} from 'node:crypto';
const runtime=await import(pathToFileURL(resolve(process.env.LIVE_RUNTIME_DIR??'dist','index.js')).href);
const {recordWorkflow,prepareWorkflow,runOnPage,exportPlaywright,exportSkill}=runtime;
const exec=promisify(execFile);
const root=resolve(process.env.LIVE_OUT??`artifacts/live-web/navigation-${new Date().toISOString().replace(/[:.]/g,'-')}`);await mkdir(dirname(root),{recursive:true});await mkdir(root);
const cases=[{id:'books',url:'https://books.toscrape.com/',link:'Travel',heading:'Travel'},{id:'python-docs',url:'https://docs.python.org/3/',link:'Tutorial',heading:'The Python Tutorial'},{id:'playwright-docs',url:'https://playwright.dev/docs/intro',link:'Locators',heading:'Locators'}];
const reports=[];
const hashes={};for(const name of ['recorder','runner','evidence','prepare','exporter','recovery']){const path=resolve(process.env.LIVE_RUNTIME_DIR??'dist',name+'.js');try{hashes[name]=createHash('sha256').update(await readFile(path)).digest('hex');}catch{}}
for(const config of cases){
 const out=join(root,config.id);await mkdir(out,{recursive:true});
 const save=(name,value)=>writeFile(join(out,name),JSON.stringify(value,null,2)+'\n');
 const report={...config,runtimeHashes:hashes,checkedAt:new Date().toISOString(),operations:'Read-only catalogue/documentation navigation. Recovery mutates only this isolated browser DOM or recorded selector, never the hosted website.'};
 try{
  const raw=await recordWorkflow(config.url,{headless:true,onReady:async context=>{
   const page=context.pages()[0];await page.getByRole('link',{name:config.link,exact:true}).click();
   const heading=page.getByRole('heading',{name:config.heading,exact:false,level:1});await heading.waitFor();
   await page.locator('#replaysmith-recorder').getByRole('button',{name:'Assert text',exact:true}).click();await heading.click();
   await page.screenshot({path:join(out,'recorded.png'),fullPage:true});
   await page.locator('#replaysmith-recorder').getByRole('button',{name:'Stop & review',exact:true}).click();
  }});await save('raw-workflow.json',raw);
  const workflow=prepareWorkflow(raw);workflow.name=`Browse ${config.id}`;await save('workflow.json',workflow);
  const browser=await chromium.launch();report.browserVersion=browser.version();
  try{
   const page=await browser.newPage();report.replay=await runOnPage(page,workflow,{timeoutMs:15000});
   report.headingObserved=await page.getByRole('heading',{name:config.heading,exact:false,level:1}).count()===1;
   const context=await browser.newContext();const changed=await context.newPage();await changed.goto(config.url,{waitUntil:'domcontentloaded'});
   await changed.getByRole('link',{name:config.link,exact:true}).evaluate(el=>{const wrapper=document.createElement('span');el.before(wrapper);wrapper.append(el);if(el.id)el.id='replaysmith-changed-id';});
   const recovery=structuredClone(workflow);recovery.steps.shift();
   report.localDomRecovery=await runOnPage(changed,recovery,{timeoutMs:15000});
   report.localRecoveryUsed=report.localDomRecovery.steps.some(step=>step.status==='recovered');
   report.recoveryHeadingObserved=await changed.getByRole('heading',{name:config.heading,exact:false,level:1}).count()===1;
  }finally{await browser.close();}
  const execute=async(path)=>{try{return {...JSON.parse((await exec(process.execPath,[path,'--timeout-ms','15000'],{timeout:90000,maxBuffer:1024*1024})).stdout),processExitCode:0};}catch(error){try{return {...JSON.parse(error.stdout),processExitCode:error.code};}catch{return {status:'unavailable',processExitCode:error.code,message:error.message};}}};
  for(const phase of ['original','stale-selectors']){
   const exported=structuredClone(workflow);
   if(phase==='stale-selectors')for(const step of exported.steps)if(step.action==='click')step.target.selectors=['#replaysmith-retired-recorded-selector'];
   const dir=join(out,phase);await mkdir(dir,{recursive:true});
   const script=join(dir,'workflow.mjs');await writeFile(script,exportPlaywright(exported));
   report[`${phase}:playwright`]=await execute(script);
   const skill=join(dir,'skill');for(const[name,content]of Object.entries(exportSkill(exported))){const path=join(skill,name);await mkdir(resolve(path,'..'),{recursive:true});await writeFile(path,content);}
   report[`${phase}:skill`]=await execute(join(skill,'scripts/run.mjs'));
  }
 }catch(error){report.error=error.message;}
 await save('report.json',report);reports.push(report);console.log(JSON.stringify({site:config.id,error:report.error,replay:report.replay?.status,verified:report.replay?.verified,recovery:report.localDomRecovery?.status,exports:['original:playwright','original:skill','stale-selectors:playwright','stale-selectors:skill'].map(key=>({mode:key,status:report[key]?.status,verified:report[key]?.verified}))}));
}
await writeFile(join(root,'report.json'),JSON.stringify(reports,null,2)+'\n');
if(reports.some(r=>r.error||!r.headingObserved||!r.recoveryHeadingObserved||!r.replay?.verified||!r.localDomRecovery?.verified||!r.localRecoveryUsed||!['original:playwright','original:skill','stale-selectors:playwright','stale-selectors:skill'].every(key=>r[key]?.verified&&r[key]?.processExitCode===0&&(key.startsWith('stale-selectors')?r[key].steps.some(step=>step.status==='recovered'):true))))process.exitCode=1;
