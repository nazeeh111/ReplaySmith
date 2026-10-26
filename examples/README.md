# Runnable local examples

Start `replaysmith studio` on the default port 3333. In another terminal, from this directory or the cloned repository:

```sh
replaysmith run examples/dispatch.workflow.json --input note='A fresh note'
replaysmith run examples/id-drift.workflow.json --input note='IDs changed; the task remains'
replaysmith run examples/reused-id.workflow.json
replaysmith run examples/missing.workflow.json  # expected abstention, exit 2
```

The first three workflows should verify a saved draft. In reused-id, an old button ID points to a delete decoy; the intended Save draft control has a new ID. The missing fixture intentionally removes the action, so replay should stop.

The `dispatch.chrome.json` file is an authored Chrome Recorder-format sample for this local site, not a claim of an exported third-party recording. Import it to see automatic named inputs. Add an exact text outcome check for `#receipt`, expected `Draft saved: {{dispatch_note}}`, before expecting a verified run.

Every URL uses the local studio and fictional data. Change the explicit origin and navigation URL together if you choose another port.
