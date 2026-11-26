import { test } from 'node:test';
import assert from 'node:assert/strict';
import { importRecording } from '../src/importer.js';

const navigate = { type: 'navigate', url: 'http://127.0.0.1:4178/' };
const down = { type: 'keyDown', key: ' ', selectors: [['#canvas-control']] };
const up = { type: 'keyUp', key: ' ' };
const click = { type: 'click', selectors: [['#point']] };

// Regression: Recorder gestures must not silently release a held key before another action.
for (const [name, records, error] of [
  ['held across click', [down, click, up], /Recording step 3:.*adjacent|Recording step 3:.*immediately/],
  ['nested key', [down, { ...down, key: 'Enter' }, up], /Recording step 3:.*adjacent|Recording step 3:.*immediately/],
  ['held across change', [down, { type: 'change', selectors: [['#q']], value: 'changed' }, up], /Recording step 3:.*adjacent|Recording step 3:.*immediately/],
  ['held across viewport', [down, { type: 'setViewport', width: 800, height: 600 }, up], /Recording step 3:.*adjacent|Recording step 3:.*immediately/],
  ['mismatched release', [down, { ...up, key: 'Enter' }], /Recording step 3:.*unmatched keyUp/],
  ['unfinished press', [down], /Recording step 2:.*unfinished keyDown/],
  ['release without press', [up], /Recording step 2:.*unmatched keyUp/],
] as const) {
  test(`Recorder refuses ${name} at its offending record`, () => {
    assert.throws(() => importRecording({ steps: [navigate, ...records] }), error);
  });
}

test('adjacent matched pairs retain their target, order and both navigation assertions', () => {
  const workflow = importRecording({ steps: [navigate,
    { ...down, assertedEvents: [{ type: 'navigation', url: 'http://127.0.0.1:4178/down' }] },
    { ...up, assertedEvents: [{ type: 'navigation', url: 'http://127.0.0.1:4178/up' }] }, click,
    { type: 'keyDown', key: 'Enter' }, { type: 'keyUp', key: 'Enter' }] });
  assert.deepEqual(workflow.steps.map(step => step.action), ['navigate', 'press', 'assert', 'assert', 'click', 'press']);
  assert.equal(workflow.steps[1].key, ' ');
  assert.deepEqual(workflow.steps[1].target?.selectors, ['#canvas-control']);
  assert.equal(workflow.steps[2].assertion?.value, 'http://127.0.0.1:4178/down');
  assert.equal(workflow.steps[3].assertion?.value, 'http://127.0.0.1:4178/up');
  assert.deepEqual(workflow.steps[5].target, workflow.steps[4].target);
});

test('consuming a matched release preserves metadata refusals and identifies its record', () => {
  for (const [release, error] of [
    [{ ...up, frame: [0] }, /Recording step 3: frames are not supported/],
    [{ ...up, target: 'popup' }, /Recording step 3: popup\/secondary targets are not supported/],
    [{ ...up, assertedEvents: {} }, /Recording step 3: assertedEvents must be an array/],
    [{ ...up, assertedEvents: [{ type: 'download' }] }, /Recording step 3: unsupported asserted event/],
  ] as const) assert.throws(() => importRecording({ steps: [navigate, down, release] }), error);
});

test('an explicit simple press becomes the receiver of a following selectorless pair', () => {
  const workflow = importRecording({ steps: [navigate, { type: 'click', selectors: [['#a']] },
    { ...down, selectors: [['#b']] }, up,
    { type: 'keyDown', key: 'Enter' }, { type: 'keyUp', key: 'Enter' }] });
  assert.deepEqual(workflow.steps.filter(step => step.action === 'press').map(step => step.target?.selectors), [['#b'], ['#b']]);
});

test('Tab invalidates inferred focus while an explicit receiver remains supported', () => {
  const prefix = [navigate, { type: 'click', selectors: [['#a']] }, { ...down, key: 'Tab' }, { ...up, key: 'Tab' }];
  assert.throws(() => importRecording({ steps: [...prefix,
    { type: 'keyDown', key: 'Enter' }, { type: 'keyUp', key: 'Enter' }] }),
    /Recording step 5: a key press needs a preceding focused target/);
  const workflow = importRecording({ steps: [...prefix,
    { type: 'keyDown', key: 'Enter', selectors: [['#next']] }, { type: 'keyUp', key: 'Enter' }] });
  assert.deepEqual(workflow.steps.at(-1)?.target?.selectors, ['#next']);
});

test('a navigation assertion invalidates inferred focus without dropping the assertion', () => {
  for (const records of [
    [{ type: 'click', selectors: [['#a']], assertedEvents: [{ type: 'navigation', url: navigate.url + 'next' }] }],
    [{ ...down, assertedEvents: [{ type: 'navigation', url: navigate.url + 'next' }] }, up],
    [down, { ...up, assertedEvents: [{ type: 'navigation', url: navigate.url + 'next' }] }],
  ]) {
    const prefix = [navigate, ...records];
    assert.throws(() => importRecording({ steps: [...prefix,
      { type: 'keyDown', key: 'Enter' }, { type: 'keyUp', key: 'Enter' }] }),
      /a key press needs a preceding focused target/);
    const supported = importRecording({ steps: [...prefix,
      { type: 'keyDown', key: 'Enter', selectors: [['#next']] }, { type: 'keyUp', key: 'Enter' }] });
    assert.equal(supported.steps.filter(step => step.action === 'assert').length, 1);
    assert.deepEqual(supported.steps.at(-1)?.target?.selectors, ['#next']);
  }
});
