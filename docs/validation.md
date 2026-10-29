# Release validation

## v0.1.1 real-website follow-up

Validated on 29 October 2026 with Node 24.14.0, macOS arm64, Playwright 1.64.1 and Chromium 156.0.8078.4.

- Public websites: **eight workflows on five sites**, all 11 API replays verified, three controlled local layout recoveries used recovery, and **22 actual exported processes** exited successfully with verified outcomes. Three additional fresh native recordings on Playwright documentation all captured the trailing assertion. Runtime hashes matched the final build.
- Local regression coverage: the complete 51-case run passed 45 and failed six older cases using 300–900 ms budgets during a timing slowdown. All six affected cases passed an isolated recheck with their original budgets and no source changes. This is not reported as a complete 51/51 local pass. New capture, Stop-drain, strict-CSP recovery, readiness, heading identity, candidate-deadline and export regressions passed.
- Controlled benchmark: **132 trials** with the normal **5000 ms** budget applied equally to all four policies. ReplaySmith verified all 15 supported changed-page trials, abstained safely on all 12 refusal trials, rejected all three corrupted outcomes, and took zero incorrect actions. Source/build hashes matched.
- Earlier benchmark: the complete failed 900 ms dataset is [preserved](../benchmarks/budget-900ms-results.json). One trial saved the intended value once but reported a browser click failure before verification. The duration exceeded its budget; the sanitized report omits the original browser exception type, so timeout is an inference. The new protocol changes the budget uniformly, without tuning scores or filtering trials.
- Package integrity: all **52 packaged files** matched current-source bytes; native/live and benchmark hashes matched the packaged runtime.
- Fresh consumer: installed the exact tarball into a new temporary npm project without source or development dependencies. The installed executable, browser installer, studio, verified CLI task, unverified exit code, standalone Playwright script and Agent Skill all passed; the temporary project was removed.

Stable publication is gated on the complete Linux Node 22/24 CI matrix. The release validation asset records the exact commit and completed CI run; check the release and Actions evidence rather than treating a local result as a remote pass.

The public-site checks cover five independently hosted websites and eight workflows, including two production documentation sites. The [live report](real-websites.md) separates observations, baseline failures, controlled recovery changes, and limitations. Browser tests run one test file at a time to bound local resource contention; test cases and runtime budgets remain explicit.

## v0.1.0 launch evidence

Validated on 26 October 2026 with Node 24.14.0, macOS arm64 and Playwright 1.64.1 / Chromium 156.0.8078.4.

- Full local suite: **38 passed, zero failed, zero skipped**. Covers workflow validation, imports, preparation, target ranking, real browser outcomes, adverse mutations, origin/form guards, secret handling, recorder event capture, real studio interaction, and exported scripts.
- Follow-up CLI/export checks: three passed after fixing npm executable-link detection and export exit-code parity. The browser installer wrapper then passed a clean consumer test using the dependency's published executable metadata.
- Clean consumer: installed the built tarball in a fresh temporary npm project without the source checkout or development dependencies. Executed the installed CLI, browser installer, studio, verified browser task, standalone Playwright script and Agent Skill script. Unverified CLI and exported runs returned exit 2. The temporary project was removed after verification.
- Controlled benchmark: **132 Chromium trials** with separate selector, semantic-locator, simple-heuristic and ReplaySmith policies. See [the report](benchmarks.md) and [raw evidence](../benchmarks/results.json) for exact counts, artifact hashes, settings and limitations.
- Runtime dependency audit: zero known npm vulnerabilities reported for production dependencies at check time. This is advisory-database evidence, not proof of absence.
- Independent review: reproduced and rechecked redirect navigation, implicit form submission, nested submit controls, interpolated Enter keys, recording event order, and placeholder substitution. The final probes observed zero foreign requests or unintended destructive form posts.
- Studio: actual import, input changes, verified replay, manual parameterization, assertion creation, both exports, source errors, mobile layout and browser page-error checks. Current-source screenshots use fictional local data.
- Launch media: silent H.264 MP4, 22.000 seconds, 1920×1080 at 30 fps; full decode passed. Compact GIF also fully decoded. Renderer lint/runtime/layout/contrast checks passed, followed by inspection of settled/transition frames. The renderer's automated motion module was unavailable; it is not claimed as a passed check.
- Documentation: current brand and architecture SVGs rendered and inspected; all relative Markdown links resolved.

The public CI workflow runs the full suite and one benchmark repetition on Linux with Node 22 and 24. Its live status is available through the README badge and Actions tab. Local evidence does not imply a remote job succeeded; inspect the published run for the relevant commit.

Reproduce locally with `npm ci`, `npx playwright install chromium`, `npm test`, and `npm run bench`. Check a package with `node scripts/release-check.mjs /absolute/package.tgz`. The fresh-package check requires npm download access, Chromium, and a loopback listener. The [media note](../demo/README.md) documents the capture and renderer.
