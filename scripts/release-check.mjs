// Fresh consumer check: no source checkout or TypeScript runtime is used by the installed package.
import {mkdtemp,readFile,writeFile,mkdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
const exec=promisify(execFile);
const tar=process.argv[2];if(!tar)throw new Error('Usage: node scripts/release-check.mjs /absolute/replaysmith-version.tgz');
const root=await mkdtemp(join(tmpdir(),'replaysmith-fresh-'));
let studio;
try {
  await exec('npm',['install','--ignore-scripts','--no-audit','--no-fund',resolve(tar)],{cwd:root,timeout:120000});
  const installed=await import(pathToFileURL(join(root,'node_modules/replaysmith/dist/index.js')).href);
  const cli=join(root,'node_modules/.bin/replaysmith');
  const version=await exec(cli,['--version'],{cwd:root});assert.equal(version.stdout.trim(),JSON.parse(await readFile(new URL('../package.json',import.meta.url),'utf8')).version);
  await exec(cli,['install-browser'],{cwd:root,timeout:120000});
  studio=await installed.startStudio(0);
  assert.equal((await fetch(studio.origin)).status,200);
  const workflow=await(await fetch(studio.origin+'/api/example')).json();
  const task=join(root,'task.json');await writeFile(task,JSON.stringify(workflow));
  const run=await exec(cli,['run',task,'--timeout-ms','15000','--input','note=Fresh consumer install checked'],{cwd:root,timeout:60000});
  const result=JSON.parse(run.stdout);assert.equal(result.status,'passed');assert.equal(result.verified,true);
  const unverified={...workflow,steps:workflow.steps.slice(0,-1)};const unverifiedTask=join(root,'unverified.json');await writeFile(unverifiedTask,JSON.stringify(unverified));
  await assert.rejects(exec(cli,['run',unverifiedTask],{cwd:root,timeout:60000}),error=>error.code===2);
  const unverifiedScript=join(root,'unverified.mjs');await exec(cli,['export',unverifiedTask,'--format','playwright','-o',unverifiedScript],{cwd:root});await assert.rejects(exec(process.execPath,[unverifiedScript],{cwd:root,timeout:60000}),error=>error.code===2);
  const code=join(root,'workflow.mjs');await exec(cli,['export',task,'--format','playwright','-o',code],{cwd:root});
  const exported=JSON.parse((await exec(process.execPath,[code,'--inputs','{"note":"Standalone export checked"}'],{cwd:root,timeout:60000})).stdout);assert.equal(exported.verified,true);
  const skillDir=join(root,'exported-skills');await exec(cli,['export',task,'--format','skill','-o',skillDir],{cwd:root});
  const slug=installed.skillName(workflow);const manifest=await readFile(join(skillDir,slug,'SKILL.md'),'utf8');assert.match(manifest,new RegExp(`^name: ${slug}$`,'m'));
  const skill=JSON.parse((await exec(process.execPath,[join(skillDir,slug,'scripts/run.mjs'),'--timeout-ms','15000','--inputs','{"note":"Skill export checked"}'],{cwd:root,timeout:60000})).stdout);assert.equal(skill.verified,true);
  console.log(JSON.stringify({package:resolve(tar),version:version.stdout.trim(),freshInstall:true,studio:true,cliVerified:result.verified,standaloneExportVerified:exported.verified,agentSkillVerified:skill.verified,skillDirectory:slug},null,2));
} finally {
  if(studio){studio.server.closeAllConnections();await studio.close();}
  await rm(root,{recursive:true,force:true});
}
