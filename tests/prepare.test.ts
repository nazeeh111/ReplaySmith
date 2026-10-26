import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareWorkflow} from '../src/prepare.js';
import {demoWorkflow} from '../src/demo.js';

test('automatically prepare captured values and their literal outcome checks without mutating original',()=>{
 const original=demoWorkflow('http://127.0.0.1:3333');original.inputs={};original.steps[1].value='Field kit for Avery';original.steps[3].assertion!.value='Draft saved: Field kit for Avery';
 const next=prepareWorkflow(original);assert.deepEqual(next.inputs,{dispatch_note:{default:'Field kit for Avery'}});assert.equal(next.steps[1].value,'{{dispatch_note}}');assert.equal(next.steps[3].assertion!.value,'Draft saved: {{dispatch_note}}');assert.equal(original.steps[1].value,'Field kit for Avery');
});
test('secret preparation discards default and does not inject secrets into other fields',()=>{
 const workflow=demoWorkflow('http://127.0.0.1:3333');workflow.inputs={};workflow.steps=workflow.steps.slice(0,2);workflow.steps[1].target!.evidence={type:'password',label:'Password'};workflow.steps[1].value='test-only-private';
 const next=prepareWorkflow(workflow);assert.equal(next.inputs.password.secret,true);assert.equal(next.inputs.password.default,undefined);assert.equal(JSON.stringify(next).includes('test-only-private'),false);
});

test('preparation never rewrites placeholder names or guesses between identical captured values',()=>{
 const workflow=demoWorkflow('http://127.0.0.1:3333');workflow.inputs={};workflow.steps[1].target!.evidence={label:'Name'};workflow.steps[1].value='Alice';workflow.steps.splice(2,0,{id:'extra',action:'fill',target:{selectors:['#another'],evidence:{label:'Note'}},value:'name'});workflow.steps.at(-1)!.assertion!.value='Saved Alice';
 const next=prepareWorkflow(workflow);assert.equal(next.steps.at(-1)!.assertion!.value,'Saved {{name}}');
 workflow.steps[2].value='Alice';const duplicate=prepareWorkflow(workflow);assert.equal(duplicate.steps.at(-1)!.assertion!.value,'Saved Alice');
});
