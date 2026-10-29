// Explicit opt-in: makes read-only/local-state requests to public external websites.
import {mkdir,writeFile} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {resolve,join,dirname} from 'node:path';
const args=process.argv.slice(2);
if(args.includes('--help')){console.log('Usage: npm run test:live -- [--out new-directory]\nPublic documentation/catalogue navigation, browser-local TodoMVC and Internet test controls. No accounts or purchases. External availability is required; not part of CI.');process.exit(0);}
if(args.length&&!(args.length===2&&args[0]==='--out'))throw new Error('Use --out <new-directory> or --help.');
const out=resolve(args[1]??`artifacts/live-web/run-${new Date().toISOString().replace(/[:.]/g,'-')}`);
await mkdir(dirname(out),{recursive:true});await mkdir(out); // Refuse overwriting a previous acceptance run.
const suites=[['navigation','scripts/live-navigation.mjs',[]],['todomvc','scripts/live-todomvc.mjs',[]],['internet','scripts/live-internet.mjs',['--out',join(out,'internet')]]];
const results=[];
for(const[name,script,extra]of suites){
 const startedAt=new Date().toISOString();console.log(`Running public-site ${name} checks…`);
 const result=await new Promise(resolveProcess=>{
  const child=spawn(process.execPath,[script,...extra],{env:{...process.env,LIVE_OUT:join(out,name)},stdio:['ignore','pipe','pipe']});
  let stdout='',stderr='';const timer=setTimeout(()=>child.kill('SIGTERM'),20*60*1000);
  child.stdout.on('data',b=>stdout+=b);child.stderr.on('data',b=>stderr+=b);
  child.on('error',error=>{clearTimeout(timer);resolveProcess({code:1,error:error.message,stdout,stderr});});
  child.on('close',(code,signal)=>{clearTimeout(timer);resolveProcess({code,signal,stdout,stderr});});
 });
 await writeFile(join(out,`${name}.log`),result.stdout+(result.stderr?`\n${result.stderr}`:''));
 results.push({suite:name,startedAt,completedAt:new Date().toISOString(),exitCode:result.code,signal:result.signal,error:result.error});
 console.log(`${name}: ${result.code===0?'passed':'failed or unavailable'}; evidence ${join(out,name)}`);
 await writeFile(join(out,'summary.json'),JSON.stringify({output:out,scope:'Public-site smoke tests; not general reliability statistics. External outages count as failed/unavailable, never success.',suites:results},null,2)+'\n');
}
if(results.some(result=>result.exitCode!==0))process.exitCode=1;
console.log(`Saved evidence: ${out}`);
