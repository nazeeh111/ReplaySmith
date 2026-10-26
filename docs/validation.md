# Release validation

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
