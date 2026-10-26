import test from 'node:test';
import assert from 'node:assert/strict';
import { median, parseBenchmarkArgs, summarize, type Trial } from '../benchmarks/run.js';

function trial(overrides: Partial<Trial> = {}): Trial {
  return {
    policy: 'recovery', variant: 'original', group: 'control', expectation: 'complete', iteration: 1,
    durationMs: 10, taskCompleted: true, verifiedCompletion: true, safeAbstention: false, safeStop: false,
    state: { saved: 'note', saveCount: 1, wrongActions: 0 },
    result: { workflow: 'test', status: 'passed', verified: true, durationMs: 10, steps: [] },
    ...overrides,
  };
}

test('benchmark separates explicit abstention, timeout safe stop, and incorrect actions', () => {
  const report = summarize([
    trial({ variant: 'missing', group: 'unsafe-target', expectation: 'abstain', taskCompleted: false, verifiedCompletion: false, safeStop: true, safeAbstention: true, state: { saved: null, saveCount: 0, wrongActions: 0 } }),
    trial({ variant: 'disabled', group: 'unsafe-target', expectation: 'abstain', taskCompleted: false, verifiedCompletion: false, safeStop: true, state: { saved: null, saveCount: 0, wrongActions: 0 } }),
    trial({ variant: 'reused-id', group: 'recoverable', taskCompleted: false, verifiedCompletion: false, state: { saved: null, saveCount: 0, wrongActions: 1 } }),
  ]).find(row => row.policy === 'recovery')!;
  assert.equal(report.safeAbstentions, 1);
  assert.equal(report.safeStops, 2);
  assert.equal(report.refusalTrials, 2);
  assert.equal(report.incorrectActions, 1);
  assert.equal(report.incorrectActionTrials, 1);
  assert.equal(report.recoverableTrials, 1);
  assert.equal(report.recoverableCompleted, 0);
});

test('benchmark preserves independent task completion and reported verification', () => {
  const report = summarize([
    trial(),
    trial({ variant: 'id-drift', group: 'recoverable', verifiedCompletion: false }),
    trial({ variant: 'wrong-outcome', group: 'outcome-failure', expectation: 'fail', taskCompleted: false, verifiedCompletion: false, state: { saved: 'corrupted', saveCount: 1, wrongActions: 0 } }),
  ]).find(row => row.policy === 'recovery')!;
  assert.equal(report.completed, 2);
  assert.equal(report.verifiedCompleted, 1);
  assert.equal(report.recoverableCompleted, 1);
  assert.equal(report.incorrectActions, 0);
  assert.equal(report.trials, 3);
});

test('timing median handles even samples and empty policies without inventing zero', () => {
  assert.equal(median([100, 10, 20, 30]), 25);
  assert.equal(median([]), null);
  assert.equal(summarize([])[0].originalMedianMs, null);
});

test('benchmark CLI honors repetition flags, environment fallback, and help before browser startup', () => {
  assert.deepEqual(parseBenchmarkArgs([], undefined), { repetitions: 3, help: false });
  assert.equal(parseBenchmarkArgs([], '5').repetitions, 5);
  assert.equal(parseBenchmarkArgs(['--repetitions', '1'], '5').repetitions, 1);
  assert.equal(parseBenchmarkArgs(['--repetitions=2'], '5').repetitions, 2);
  assert.equal(parseBenchmarkArgs(['--help'], 'invalid').help, true);
  for (const args of [['--repetitions'], ['--repetitions', '0'], ['--repetitions', '21'], ['--repetitions', '1.5'], ['--typo'], ['--repetitions', '1', '--repetitions', '2']]) assert.throws(() => parseBenchmarkArgs(args));
});
