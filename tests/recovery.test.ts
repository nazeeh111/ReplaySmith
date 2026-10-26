import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chooseCandidate, rankCandidates, scoreEvidence } from '../src/recovery.js';
test('context distinguishes same-name controls and supports a modest wording change', () => {
  const expected={role:'button',name:'Save draft',context:'Expense report',tag:'button'};
  const ranked=rankCandidates(expected,[{role:'button',name:'Save draft',context:'Travel plans',tag:'button'},{role:'button',name:'Save draft changes',context:'Expense report',tag:'button'}]);
  assert.equal(chooseCandidate(ranked)?.index,1);
  assert.ok(ranked[0].score>=.78);
});
test('ties, weak evidence and role conflicts abstain', () => {
  assert.equal(chooseCandidate(rankCandidates({role:'button',name:'Save'},[{role:'button',name:'Save'},{role:'button',name:'Save'}])),undefined);
  assert.equal(scoreEvidence({role:'button'},{role:'button'}).score,0);
  assert.equal(scoreEvidence({role:'button',name:'Save'},{role:'link',name:'Save'}).score,0);
});
