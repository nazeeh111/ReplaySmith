import test from 'node:test';
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp,readFile,writeFile,rm,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const exec=promisify(execFile);
const cli=join(process.cwd(),'dist/cli.js');
const expectedVersion=JSON.parse(await readFile(join(process.cwd(),'package.json'),'utf8')).version;

test('CLI version, example, inspect, export and overwrite protection',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'replaysmith-cli-'));
  try{
    const version=await exec(process.execPath,[cli,'--version']);assert.equal(version.stdout.trim(),expectedVersion);
    const linked=join(dir,'replaysmith');await symlink(cli,linked);
    const linkedVersion=await exec(process.execPath,[linked,'--version']);assert.equal(linkedVersion.stdout.trim(),expectedVersion);
    const task=join(dir,'task.json');await exec(process.execPath,[cli,'example','-o',task]);
    const inspect=await exec(process.execPath,[cli,'inspect',task]);assert.match(inspect.stdout,/Save a dispatch note/);
    const script=join(dir,'workflow.mjs');await exec(process.execPath,[cli,'export',task,'--format','playwright','-o',script]);assert.match(await readFile(script,'utf8'),/chromium/);
    await assert.rejects(exec(process.execPath,[cli,'example','-o',task]),/EEXIST/);
    assert.equal(JSON.parse(await readFile(task,'utf8')).version,1);
    await assert.rejects(exec(process.execPath,[cli,'--unknown']),/Unknown option/);
    for(const value of ['99'])await assert.rejects(exec(process.execPath,[cli,'run',task,'--timeout-ms',value]),/--timeout-ms must be an integer from 100 to 60000/);
    const recording=join(dir,'recording.json');await writeFile(recording,JSON.stringify({title:'Import test',steps:[{type:'navigate',url:'https://example.org'}]}));
    await exec(process.execPath,[cli,'import',recording,'-o',join(dir,'imported.json')]);
    assert.equal(JSON.parse(await readFile(join(dir,'imported.json'),'utf8')).name,'Import test');
  }finally{await rm(dir,{recursive:true,force:true});}
});
