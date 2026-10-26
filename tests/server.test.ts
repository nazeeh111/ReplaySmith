import test from 'node:test';
import assert from 'node:assert/strict';
import {startStudio} from '../src/server.js';

test('studio serves real API, rejects cross-site writes, validates input and runs verified example',async()=>{
  const studio=await startStudio(0);
  const api=(path:string,body:unknown,headers:Record<string,string>={})=>fetch(studio.origin+path,{method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify(body)});
  try{
    const page=await fetch(studio.origin);assert.equal(page.status,200);assert.match(page.headers.get('content-security-policy')??'',/frame-ancestors 'none'/);assert.match(await page.text(),/ReplaySmith/);
    const workflow=await(await fetch(studio.origin+'/api/example')).json();
    const denied=await api('/api/run',{workflow},{Origin:'https://attacker.example'});assert.equal(denied.status,403);
    const invalid=await api('/api/validate',{workflow:{version:4}});assert.equal(invalid.status,422);
    const unsupported=await api('/api/import',{recording:{steps:[{type:'executeJavaScript'}]}});assert.equal(unsupported.status,422);
    const result=await(await api('/api/run',{workflow,inputs:{note:'Integration checked'}})).json();assert.equal(result.status,'passed');assert.equal(result.verified,true);
    const exported=await(await api('/api/export',{workflow,format:'skill'})).json();assert.ok(exported.files['SKILL.md']);assert.ok(exported.files['scripts/run.mjs']);
    const traversal=await fetch(studio.origin+'/%2e%2e/package.json');assert.equal(traversal.status,404);
  }finally{await studio.close();}
});
