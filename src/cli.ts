#!/usr/bin/env node
import { readFile, writeFile, mkdir, lstat } from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { importRecording } from './importer.js';
import { validateWorkflow, parameterize } from './workflow.js';
import { runWorkflow } from './runner.js';
import { exportPlaywright, exportSkill, skillName } from './exporter.js';
import { startStudio } from './server.js';
import { demoWorkflow } from './demo.js';
import { recordWorkflow } from './recorder.js';
import { prepareWorkflow } from './prepare.js';

const HELP=`
  REPLAYSMITH  ·  Show it once. Run it reliably.

  replaysmith studio [--port 3333]       Open the local workflow workbench
  replaysmith record <url> -o task.json  Demonstrate in a fresh Chromium window
  replaysmith import <recording.json> -o task.json
  replaysmith inspect <task.json>       Explain steps, inputs, origins and checks
  replaysmith parameterize <task.json> --step <id> --name <input> -o new.json
  replaysmith run <task.json> [--input key=value] [--report run.json]
                              [--headed] [--allow-sensitive] [--no-recovery] [--inputs-stdin] [--timeout-ms 15000]
  replaysmith export <task.json> --format playwright -o workflow.mjs
  replaysmith export <task.json> --format skill -o ./my-skill
  replaysmith example -o task.json [--origin http://127.0.0.1:3333]
  replaysmith install-browser           Install the pinned Chromium runtime
  replaysmith --version

  Import: Chrome DevTools Recorder JSON or ReplaySmith v1 JSON.
  Run exits 0 only for a verified outcome; 2 for abstention/unverified; 1 for errors.
  Recording is limited to one tab and one origin. Add outcome checks before replay.
  Output paths must be new; existing files are never silently overwritten.
`;
const valueOptions=new Set(['out','o','port','step','name','format','input','report','origin','timeout-ms']);
const flagOptions=new Set(['headed','allow-sensitive','no-recovery','inputs-stdin','help','version']);
function parse(args:string[]) {
  const positional:string[]=[];const values:Record<string,string[]>={};const flags=new Set<string>();
  for(let i=0;i<args.length;i++) {
    const arg=args[i];
    if(!arg.startsWith('-')){positional.push(arg);continue;}
    const raw=arg.replace(/^--?/,'');const equal=raw.indexOf('=');const key=equal<0?raw:raw.slice(0,equal);
    if(flagOptions.has(key)){if(equal>=0)throw new Error(`Flag --${key} does not take a value.`);flags.add(key);continue;}
    if(!valueOptions.has(key))throw new Error(`Unknown option: ${arg}`);
    const value=equal<0?args[++i]:raw.slice(equal+1);
    if(value===undefined||value.startsWith('--'))throw new Error(`Missing value for --${key}`);
    (values[key]??=[]).push(value);
  }
  return{positional,flags,value:(key:string)=>values[key]?.at(-1),all:(key:string)=>values[key]??[]};
}
async function readJson(path:string|undefined):Promise<unknown>{if(!path)throw new Error('Provide a workflow or recording file.');const bytes=await readFile(resolve(path));if(bytes.length>2*1024*1024)throw new Error('Input exceeds 2 MiB.');return JSON.parse(bytes.toString('utf8'));}
async function writeNew(path:string|undefined,content:string){if(!path)throw new Error('Provide a new output path with -o.');await mkdir(dirname(resolve(path)),{recursive:true});await writeFile(resolve(path),content,{flag:'wx',mode:0o600});}
async function absent(path:string){try{await lstat(path);throw new Error(`Output already exists: ${path}`);}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}}
export async function main(args=process.argv.slice(2)):Promise<number> {
  const options=parse(args);const[command,file]=options.positional;const out=options.value('out')??options.value('o');
  if(options.flags.has('version')){console.log(JSON.parse(await readFile(new URL('../package.json',import.meta.url),'utf8')).version);return 0;}
  if(options.flags.has('help')||!command){console.log(HELP);return 0;}
  switch(command) {
    case 'studio': {const port=Number(options.value('port')??3333);const studio=await startStudio(port);console.log(`ReplaySmith studio: ${studio.origin}\nPress Ctrl+C to stop.`);const stop=()=>{void studio.close().then(()=>process.exit(0));};process.once('SIGINT',stop);process.once('SIGTERM',stop);return 0;}
    case 'install-browser': {const packageFile=createRequire(import.meta.url).resolve('playwright/package.json');const manifest=JSON.parse(await readFile(packageFile,'utf8'));const cli=resolve(dirname(packageFile),manifest.bin.playwright);const result=spawnSync(process.execPath,[cli,'install','chromium'],{stdio:'inherit'});if(result.error)throw result.error;return result.status??1;}
    case 'example':await writeNew(out,JSON.stringify(demoWorkflow(options.value('origin')??'http://127.0.0.1:3333'),null,2)+'\n');console.log(`Created ${out}`);return 0;
    case 'import':await writeNew(out,JSON.stringify(prepareWorkflow(importRecording(await readJson(file))),null,2)+'\n');console.log(`Imported ${out}. Review origins, inputs and outcome checks.`);return 0;
    case 'record': {
      if(!file||!out)throw new Error('Usage: replaysmith record <url> -o task.json');await absent(resolve(out));
      const controller=new AbortController();const stop=()=>controller.abort();process.once('SIGINT',stop);
      try{const workflow=prepareWorkflow(await recordWorkflow(file,{signal:controller.signal}));await writeNew(out,JSON.stringify(validateWorkflow(workflow),null,2)+'\n');console.log(`Recorded ${workflow.steps.length} steps to ${out}. Review before replay.`);return 0;}finally{process.removeListener('SIGINT',stop);}
    }
    case 'inspect': {const workflow=validateWorkflow(await readJson(file));console.log(`${workflow.name}\nOrigins: ${workflow.allowedOrigins.join(', ')}\nInputs: ${Object.keys(workflow.inputs).join(', ')||'(none)'}\n`);for(const step of workflow.steps)console.log(`${step.id.padEnd(16)} ${step.action.padEnd(9)} ${step.description??step.target?.evidence.name??step.assertion?.kind??''}${step.sensitive?' [explicit permission required]':''}`);if(workflow.steps.at(-1)?.action!=='assert')console.log('\nNo final outcome check. Add an assertion before relying on replay.');return 0;}
    case 'parameterize': {const workflow=parameterize(validateWorkflow(await readJson(file)),options.value('step')??'',options.value('name')??'');await writeNew(out,JSON.stringify(workflow,null,2)+'\n');console.log(`Created ${out}`);return 0;}
    case 'run': {
      const timeoutMs=Number(options.value('timeout-ms')??5000);
      if(!Number.isInteger(timeoutMs)||timeoutMs<100||timeoutMs>60000)throw new Error('--timeout-ms must be an integer from 100 to 60000.');
      const workflow=validateWorkflow(await readJson(file));const inputs:Record<string,string>={};
      for(const pair of options.all('input')){const equal=pair.indexOf('=');if(equal<1)throw new Error('Use --input name=value.');inputs[pair.slice(0,equal)]=pair.slice(equal+1);}
      // Secret values can be supplied through stdin JSON to avoid shell history/process arguments.
      if(options.flags.has('inputs-stdin')){let bytes='';for await(const chunk of process.stdin){bytes+=chunk;if(bytes.length>65536)throw new Error('stdin input exceeds 64 KiB.');}if(bytes.trim()){const object=JSON.parse(bytes);if(!object||typeof object!=='object'||Array.isArray(object))throw new Error('stdin must contain an input object.');for(const [key,value]of Object.entries(object)){if(typeof value!=='string')throw new Error('stdin inputs must be strings.');inputs[key]=value;}}}
      const report=options.value('report');if(report)await absent(resolve(report));
      const result=await runWorkflow(workflow,{inputs,headless:!options.flags.has('headed'),allowSensitive:options.flags.has('allow-sensitive'),recovery:!options.flags.has('no-recovery'),timeoutMs});
      console.log(JSON.stringify(result,null,2));if(report)await writeNew(report,JSON.stringify(result,null,2)+'\n');
      return result.status==='passed'&&result.verified?0:result.status==='failed'?1:2;
    }
    case 'export': {
      const workflow=validateWorkflow(await readJson(file));const format=options.value('format');
      if(format==='playwright')await writeNew(out,exportPlaywright(workflow));
      else if(format==='skill') {if(!out)throw new Error('Provide a new skill directory with -o.');await mkdir(resolve(out));const skillRoot=join(resolve(out),skillName(workflow));await mkdir(skillRoot);const files=exportSkill(workflow);for(const [name,content]of Object.entries(files)){if(name.includes('..')||name.startsWith('/')||name.includes('\\'))throw new Error('Invalid exported path.');await writeNew(join(skillRoot,name),content);}}
      else throw new Error('Choose --format playwright or --format skill.');console.log(`Exported ${out}`);return 0;
    }
    default:throw new Error(`Unknown command: ${command}. Run replaysmith --help.`);
  }
}
if(process.argv[1]&&import.meta.url===pathToFileURL(realpathSync(resolve(process.argv[1]))).href){main().then(code=>{process.exitCode=code;}).catch(error=>{console.error(`ReplaySmith: ${error instanceof Error?error.message:'Operation failed'}`);process.exitCode=1;});}
