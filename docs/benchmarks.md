# Controlled browser benchmark

Generated 2026-10-29T06:07:01.781Z. Full per-trial evidence: [results.json](../benchmarks/results.json).

## Reproduce

```sh
npm ci
npx playwright install chromium
npm run bench
# Optional: npm run bench -- --repetitions 5
```

3 repetitions of 11 local scenarios for each of four policies. Each policy uses the same 5000 ms timeout setting for target resolution, actions, and assertions. A resolution wait and a subsequent action can each consume this setting; elapsed time is recorded directly. Each trial uses a fresh browser context; browser launch and context creation are excluded from elapsed time. Policy order rotates between repetitions. The JSON includes SHA-256 hashes of the runtime, fixture, benchmark source, and dependency lockfile read before execution. Environment: Node v24.14.0; darwin/arm64; Chromium 156.0.8078.4.

## Observed results

| Policy | Task completed | Trials with wrong action | Safe abstentions | Safe stops | Recoverable changes completed | Original median ms |
| --- | --- | --- | --- | --- | --- | --- |
| selector | 3/33 | 3 | 0/12 | 12/12 | 0/15 | 173 |
| semantic | 15/33 | 0 | 0/12 | 12/12 | 12/15 | 100.2 |
| heuristic | 18/33 | 6 | 0/12 | 6/12 | 12/15 | 234 |
| recovery | 18/33 | 0 | 12/12 | 12/12 | 15/15 | 641 |

Task completion is independent fixture ground truth: the exact input was saved once and no decoy action fired. Wrong actions count clicks on the instrumented delete decoy, not merely a failed assertion. Safe abstention means an explicit abstained result with zero saves and zero decoy actions on a case designated for refusal. Safe stop also includes timeout/failure before side effects. These measures are separated because a timeout is not an explained abstention.

On the unchanged control, recovery's measured median difference was 468 ms relative to the selector baseline and 540.8 ms relative to the semantic baseline. These tiny local samples are timing observations, not statistically supported speed claims. All-case medians in JSON include intentional waits and failures and should not be interpreted as runtime overhead.

## Earlier short-budget run

An earlier 900 ms run on this final runtime saved the correct input once in all 15 recoverable trials, but one click timed out after its side effect, preventing verification in that trial. The complete [900 ms evidence](../benchmarks/budget-900ms-results.json) is preserved, including the failed acceptance gate. The canonical benchmark now uses the ordinary 5000 ms runtime budget equally for all four policies. This changes the declared protocol, not ranking thresholds or success criteria; the earlier run is not relabeled as successful.

## Policies

The three baselines are implemented independently in [run.ts](../benchmarks/run.ts) and do not call ReplaySmith's score or resolver. They share navigation, input, exact receipt checking, and operation budgets.

* **selector:** ordinary first recorded CSS selector with Playwright's native actionability/strictness checks; no semantic identity check.
* **semantic:** exact role/name, label, test-ID, placeholder, or text locator. It uses the first available locator contract and Playwright's native strictness and waits.
* **heuristic:** existing recorded selector, then unique exact semantic target, then first visible same-tag candidate with any name/text token overlap. It has no confidence margin and can choose the wrong equivalent-looking control.
* **recovery:** the actual exported ReplaySmith runtime with its selector evidence checks, semantic candidates, deterministic evidence ranking, threshold/margin refusal, and outcome verification.

## Scenarios and limits

| Scenario | Change | Declared expectation |
| --- | --- | --- |
| original | Unchanged form | Complete |
| id-drift | Field and button IDs change | Complete |
| wrapper-drift | Button ID changes and wrapper is inserted | Complete |
| wording-extension | Button becomes “Save draft now”; old ID removed | Complete |
| reused-id | Old save ID moves to a delete decoy | Complete without clicking decoy |
| delayed | Replacement button arrives after 450 ms | Complete within operation budget |
| renamed | Button becomes “Store draft”; no synonym inference assumed | Abstain |
| ambiguous | Two identical-label controls; the first is a decoy | Abstain |
| missing | Save control removed | Abstain |
| disabled | Save control disabled | Abstain |
| wrong-outcome | Click handler saves corrupted contents | Fail verification |

Fixtures derive from [demo.ts](../src/demo.ts). The benchmark preserves the note field ID except in id-drift, isolating each button mutation so a raw-selector trial can reach the reused-ID decoy. Changed button IDs and the fixture's independently instrumented side effects remain intact. The wrapper and wording-extension mutations are applied in the benchmark server. In the ambiguous case the first identical-label control is an instrumented decoy, making arbitrary selection observably incorrect.

This is a small synthetic regression suite, built alongside the implementation. It is not a held-out evaluation, production-site study, or evidence of universal self-healing. Recoverable cases were declared before execution; results are not filtered to successful runs. No ranking weights or thresholds are tuned by this benchmark. The synonym rename intentionally remains outside supported inference. Missing/ambiguous/disabled targets should stop without actions; the corrupted outcome must never be marked verified.

A run exits unsuccessfully if recovery clicks a decoy, falsely reports a corrupted outcome verified, fails a scenario declared complete, or fails to explicitly abstain on a refusal scenario. Other policies' failures are observations, not benchmark errors.
