# Source preview verification

This is unreleased **0.1.2-dev.0** source. The published v0.1.1 release, historical benchmark packet and earlier live-site reports are separate artifacts. They are preserved and are not measurements of this preview.

## Source and scope

The engineering parent is [`3e3280856cfb8eca7ea52e20149360673bb8fd64`](https://github.com/nazeeh111/ReplaySmith/commit/3e3280856cfb8eca7ea52e20149360673bb8fd64), with 135 original paths and tree `d271b04dc1221c1d9be60997f51bca2d5f9dacba`. It adds the continuation barrier, empty-field and native checkbox/radio outcomes, and cancellation when the studio request disconnects or server closes. A separate review covered 26 checkpoints and 18 selected regressions on that parent. This is bounded review, not acceptance of every product behavior or atomic target identity.

The presentation pass changes studio contrast, report wording, navigation-origin copy and dialog names. It preserves the parent's runner, resolver, exports, report JSON, tests, workflow configuration, historical research/media and release assets. An exact duplicate matched-step message is suppressed only in the displayed report; a prominent target-identity limitation remains in every report state. The parent's complete README is preserved byte for byte as [TECHNICAL_GUIDE.md](TECHNICAL_GUIDE.md).

## Checks performed on 2026-11-17

- **Existing full suite: 68 passed, zero failed or skipped.** Original `npm test` commands and assertions, Node 24.14.0, TypeScript 5.9.3, Playwright 1.64.1 and matching Chromium headless shell 1248 (Chrome 156.0.8078.4). This includes the real recorder, replay, both executable export formats, studio UI, asynchronous field-state outcomes and disconnect/shutdown cancellation. An initial test startup failed because the restored task PATH lacked Node; no test ran until the task child PATH was corrected.
- **Actual studio and independent effect.** A recorded and prepared dispatch workflow was imported through the studio, given a different run input and executed. A separate HTTP fixture recorded exactly one matching save. The recorder was exercised headlessly through its supported API; the studio's headed recording-start gesture was not exercised in this pass.
- **Actual downloaded artifacts.** Native studio buttons downloaded workflow JSON, a Playwright script and a Skill ZIP. The JSON equaled the prepared recording. All four ZIP members passed CRC; its script equaled the standalone download. Fresh standalone, extracted-Skill and CLI processes each passed with exactly one independently observed matching save. No Skill was installed into the host.
- **Failure controls.** A deliberately incorrect outcome returned exit 1 after one save, without automatically repeating it. Reusing an existing CLI report path returned exit 1, preserved the report bytes and caused no new save. This is a controlled fixture result, not a general exactly-once guarantee.
- **Outcome editor.** Actual studio dialogs created an intentionally empty field-value check, a checked-checkbox check and an unchecked-radio check. The real runner verified all three against a synthetic settings page. Invalid JSON was rejected while the last applied four-step workflow remained intact.
- **Interface.** Workflow, report, source and export dialog fit at widths 320, 390 and 1280. All 12 axe scans using WCAG 2 A/AA, 2.1 A/AA and 2.2 AA tags reported zero violations. Each retained a contrast item requiring manual review for glyphs, pseudo-elements or gradients. Baseline scans had one contrast rule violation affecting 10 editor/source nodes and six export-dialog nodes. Existing arrow-key tabs selected and focused the correct panel; no repair to that behavior was needed. No page errors or console errors were observed in the native pass. This is not exhaustive assistive-technology, performance or all-browser testing.

The [current captures](assets/source-preview/CAPTURES.md) show actual software and synthetic local data. Times shown in reports describe individual runs, not a benchmark. Earlier captures and incomplete probes remain attributed to their original source. A stalled earlier download helper was inconclusive; ordinary native export-button downloads were subsequently verified without changing the application policy or browser domain guard. Temporary fixture reconstruction after an interrupted session does not establish product crash recovery.

## Boundaries

Outcome success does not prove which element received an action. Admission, identity observation and native dispatch are separate operations. The continuation barrier stops later actions after changed or unobservable evidence; it cannot undo a dispatched action or guarantee the first effect. Cancellation is not rollback. Origin lists constrain navigation, not all page resources. No new reliability percentage, held-out study, benchmark, hosted integration, exhaustive security acceptance or universal automation claim is made.

Run the existing checks with `npm ci`, `npx playwright install chromium` and `npm test`. Package and hosted CI receipts belong to their exact source revision; a local pass alone is not a hosted CI result.
