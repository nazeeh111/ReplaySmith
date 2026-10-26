import { test } from 'node:test';
import assert from 'node:assert/strict';
import { exportPlaywright, exportSkill } from '../src/exporter.js';
import type { Workflow } from '../src/types.js';
const workflow:Workflow={version:1,name:'Catalog lookup',allowedOrigins:['http://localhost:9999'],inputs:{query:{default:'birch'}},steps:[{id:'1',action:'navigate',url:'http://localhost:9999/'}]};
test('exports standalone Playwright and a self-contained Agent Skill', () => {
  const code=exportPlaywright(workflow);
  assert.match(code,/import \{ chromium \} from 'playwright'/);
  assert.match(code,/minimum lead 0.12/);
  assert.match(code,/Consequential/);
  const skill=exportSkill(workflow);
  assert.match(skill['SKILL.md'],/^---\nname: catalog-lookup\n/);
  assert.match(skill['SKILL.md'],/node scripts\/run.mjs/);
  assert.deepEqual(JSON.parse(skill['workflow.json']),workflow);
  assert.equal(skill['scripts/run.mjs'],code);
});
test('skill dependency is pinned and scripts support private stdin inputs', () => {
  const files=exportSkill(workflow);
  assert.equal(JSON.parse(files['package.json']).dependencies.playwright,'1.64.1');
  assert.match(files['scripts/run.mjs'],/--inputs-stdin/);
  assert.match(files['scripts/run.mjs'],/result.status === 'passed' && result.verified/);
});
