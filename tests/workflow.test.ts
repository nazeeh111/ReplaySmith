import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateWorkflow, parameterize } from '../src/workflow.js';
const example = () => ({ version: 1, name: 'Search books', inputs: {}, allowedOrigins: ['http://localhost:9999'], steps: [{ id: '1', action: 'navigate', url: 'http://localhost:9999/' }, { id: '2', action: 'fill', target: { selectors: ['#query'], evidence: { role: 'textbox', name: 'Search' } }, value: 'birch' }] });
test('validates a detached workflow and parameterizes only the selected input', () => {
  const workflow = validateWorkflow(example());
  const output = parameterize(workflow, '2', 'query');
  assert.equal(output.inputs.query.default, 'birch');
  assert.equal(output.steps[1].value, '{{query}}');
  assert.equal(workflow.steps[1].value, 'birch');
});
test('rejects unsupported actions, origins, duplicated IDs and undeclared inputs', () => {
  for (const mutate of [(x: any) => x.steps[0].url = 'file:///etc/passwd', (x: any) => x.steps[0].url = 'http://other.test/', (x: any) => x.steps[1].id = '1', (x: any) => x.steps[1].action = 'eval', (x: any) => x.steps[1].value = '{{missing}}']) {
    const x = example(); mutate(x); assert.throws(() => validateWorkflow(x), /Invalid workflow/);
  }
});
test('secret parameter values never become defaults', () => {
  const workflow = validateWorkflow(example()); workflow.steps[1].target!.evidence.type = 'password';
  const output = parameterize(workflow, '2', 'password');
  assert.equal(output.inputs.password.secret, true);
  assert.equal(output.inputs.password.default, undefined);
  assert.throws(() => validateWorkflow({ ...output, inputs: { password: { secret: true, default: 'leak' } } }), /cannot store a default/);
});
test('rejects empty assertions and proto input names', () => {
  const x: any = example(); x.steps.push({ id: '3', action: 'assert', assertion: { kind: 'text', target: { selectors:['#status'], evidence:{} }, value: '' } });
  assert.throws(() => validateWorkflow(x), /cannot be empty/);
  x.inputs = JSON.parse('{"__proto__":{}}'); assert.throws(() => validateWorkflow(x), /invalid input name/);
});
