# A receipt passes. The next action waits.

These are two synthetic, owned loopback pages, not private browser traces or a reliability benchmark. Both run Pause and expose a Done receipt. One changes the button name to Paused immediately after dispatch. Its read-only receipt check still passes, but the continuation barrier withholds Next. The matched control continues. The first effect is already real in both cases. Neither result proves identity at dispatch.

[Changed native report](changed-report.json) · [Matched native report](matched-report.json) · [Exact execution/counters](execution.json) · [Fixture source](fixture.mjs) · [Figure generator](figure.py)

The figure shows one native run per fixture: first/later effects1/0 and1/1. Export counters in execution.json are cumulative across separate runs, not additional samples or a rate. The desktop Studio capture is a fourth changed-fixture run; the true-phone capture reopens the exact downloaded workflow in a fresh context against a fresh fixture (first/later effects1/0). Runtime durations vary and are not plotted.

## Read and replay

`python3 check.py` verifies the extracted payload hashes. For actual replay, use Node22+ and the exact Playwright1.64.1 package and Chromium1248 browser. From this directory, install the declared package only if needed: `npm install --no-save --package-lock=false playwright@1.64.1`, then `npx playwright install chromium`. Existing matching browser installations can use PLAYWRIGHT_BROWSERS_PATH. Run `node replay.mjs`. It starts a fresh loopback fixture on the recorded port, refuses an occupied port, and executes both original Playwright scripts and both original Agent Skill scripts. Expected exits2/0 mean abstained/verified respectively. Ports and duration fields are run-specific. No original ReplaySmith library or Studio is needed by these exported scripts.

[Changed workflow](changed-workflow.json) · [Matched workflow](matched-workflow.json) · [Changed exported script](changed-playwright.mjs) · [Matched exported script](matched-playwright.mjs) · [Changed skill](changed-skill/SKILL.md) · [Matched skill](matched-skill/SKILL.md) · [MIT notice](LICENSE)

The actual [desktop report](studio-desktop.png) and [phone report](studio-phone.png) retain Studio's current identity. Cancel run aborts its local request and retains the workflow; already dispatched actions may have occurred. Cancellation is not rollback.

Only Chromium, one-page tasks and the supported workflow format are covered. Origin admission constrains navigation, not all network traffic. This witness establishes a detected continuation boundary, not universal target safety, atomic dispatch, broad compatibility or benchmark improvement.
