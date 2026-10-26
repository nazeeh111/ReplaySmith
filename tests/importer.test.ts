import { test } from 'node:test';
import assert from 'node:assert/strict';
import { importRecording } from '../src/importer.js';
const recording = () => ({ title:'Search catalog', steps:[{type:'setViewport',width:1200,height:800},{type:'navigate',url:'http://localhost:9999/'},{type:'change',selectors:[['#q'],['aria/Search[role="textbox"]']],value:'birch'},{type:'click',selectors:[['#go'],['aria/Search[role="button"]']],assertedEvents:[{type:'navigation',url:'http://localhost:9999/results'}]}] });
test('imports real Recorder structure, semantic evidence and navigation assertions', () => {
  const workflow = importRecording(recording());
  assert.equal(workflow.steps.length,4);
  assert.equal(workflow.steps[1].target!.evidence.name,'Search');
  assert.equal(workflow.steps[1].target!.evidence.role,'textbox');
  assert.deepEqual(workflow.steps[3].assertion,{kind:'url',value:'http://localhost:9999/results'});
});
test('rejects frame, shadow chain, unsupported operations rather than lossy imports', () => {
  for (const step of [{type:'scroll'}, {type:'click',selectors:[['host','#leaf']]}, {type:'click',frame:[0],selectors:[['#q']]}, {type:'click',target:'popup',selectors:[['#q']]}]) {
    assert.throws(() => importRecording({steps:[{type:'navigate',url:'http://localhost:9999/'},step]}), /unsupported|not supported/);
  }
});
test('marks consequential imported actions sensitive', () => {
  const workflow=importRecording({steps:[{type:'navigate',url:'http://localhost:9999/'},{type:'click',selectors:[['aria/Delete[role="button"]']]}]});
  assert.equal(workflow.steps[1].sensitive,true);
});
test('imports Recorder keyboard events using the preceding focused target', () => {
  const workflow=importRecording({steps:[{type:'navigate',url:'http://localhost:9999/'},{type:'change',selectors:[['#q']],value:'birch'},{type:'keyDown',key:'Enter'},{type:'keyUp',key:'Enter'}]});
  assert.equal(workflow.steps[2].action,'press');
  assert.deepEqual(workflow.steps[2].target,workflow.steps[1].target);
  assert.throws(()=>importRecording({steps:[{type:'navigate',url:'http://localhost:9999/'},{type:'keyUp',key:'Enter'}]}),/unmatched keyUp/);
});
test('rejects malformed assertedEvents and discards recognized private literals', () => {
  assert.throws(()=>importRecording({steps:[{type:'navigate',url:'http://localhost:9999/',assertedEvents:{type:'navigation'}}]}),/must be an array/);
  const workflow=importRecording({steps:[{type:'navigate',url:'http://localhost:9999/'},{type:'change',selectors:[['input[type="password"]']],value:'synthetic-private-example'}]});
  assert.equal(workflow.steps[1].value,'{{secret_1}}');assert.equal(workflow.inputs.secret_1.secret,true);assert.ok(!JSON.stringify(workflow).includes('synthetic-private-example'));
});
