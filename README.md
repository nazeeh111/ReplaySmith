<p align="center"><img src="assets/brand.svg" width="900" alt="ReplaySmith. Show it once. Run it reliably."></p>

<p align="center">
  <a href="https://github.com/nazeeh111/ReplaySmith/actions/workflows/ci.yml"><img src="https://github.com/nazeeh111/ReplaySmith/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="https://github.com/nazeeh111/ReplaySmith/releases"><img src="https://img.shields.io/github/v/release/nazeeh111/ReplaySmith?color=e8532d" alt="Release"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-637354" alt="MIT license"></a>
  <img src="https://img.shields.io/badge/Node.js-22%2B-637354" alt="Node.js 22 or later">
</p>

**Turn a demonstrated browser task into a reusable workflow with inputs, recovery evidence, and an outcome you can verify.** Run it locally, inspect why an element was chosen, and export the same behavior as Playwright code or an Agent Skill. No model, API key, account, or subscription required.

<p align="center"><a href="https://github.com/nazeeh111/ReplaySmith/releases/latest">Download</a> · <a href="docs/workflows.md">Workflow guide</a> · <a href="docs/benchmarks.md">Benchmarks</a> · <a href="docs/research.md">Prior art</a> · <a href="CONTRIBUTING.md">Contribute</a></p>

![Actual ReplaySmith studio demonstration](assets/demo.gif)

## Try it in two minutes

Requires **Node.js 22+** on macOS, Linux, or Windows. The release contains the built CLI and studio; you do not need a compiler.

```sh
npm install --global https://github.com/nazeeh111/ReplaySmith/releases/download/v0.1.0/replaysmith-0.1.0.tgz
replaysmith install-browser
replaysmith studio
```

Open the printed loopback URL, usually `http://127.0.0.1:3333`. The example is a real local form with a saved-note assertion. Change the **note** input and choose **Run workflow**. The report distinguishes actions completing from an outcome being verified.

On Linux, install Chromium's OS libraries with `npx playwright install --with-deps chromium` if the browser installer reports missing dependencies. Release packages are hosted on GitHub; this project is not published to the npm registry.

Prefer source?

```sh
git clone https://github.com/nazeeh111/ReplaySmith.git
cd ReplaySmith
npm ci
npx playwright install chromium
npm run studio
```

## Demonstration → dependable replay

1. **Record or import.** Demonstrate in a fresh Chromium window, or import Chrome DevTools Recorder JSON. Captured form values become named input defaults automatically. Unsupported import operations fail visibly.
2. **Understand and improve.** Inspect every step, locator, fingerprint, origin, and input. Edit the workflow in the studio or as versioned JSON. Mark consequential actions as sensitive.
3. **Verify and replay.** Add a final text, value, URL, or visibility check that expresses the intended result. Run with new inputs; inspect failures, abstentions, and candidate evidence.
4. **Export.** Download executable Playwright JavaScript or a directory-compatible Agent Skill. The export embeds the same guards, scorer, and outcome checks.

Use **Assert text** while recording to capture a result, then **Stop & review**. Recording is one tab, one origin, with a clean browser profile. It does not attach to your normal signed-in browser.

![ReplaySmith workflow studio](assets/studio.png)

## Built for the second run

A selector can still match after it has become the wrong target. ReplaySmith checks its available semantic evidence before acting. If that selector no longer fits, it tries exact semantic locators, then ranks visible candidates using role, name, label, input type, test ID, text, and named surrounding context.

- **Inspectable recovery.** Candidate scores include the evidence that contributed. Recovery requires a score of at least `0.78` and a lead of `0.12`. These are deterministic heuristics, not probabilities or a trained model.
- **Permission before consequential actions.** Marked sensitive actions, detected consequential targets, and form submissions require explicit permission and a matching recorded selector. They never use recovery.
- **A safe stopping point.** Weak, missing, disabled, or ambiguous targets cause abstention. A failed outcome does not repeat the preceding click.
- **Portable behavior.** Generated Playwright and Agent Skill scripts run without ReplaySmith and retain its safety and verification logic.

Semantic locators and self-healing automation already exist. ReplaySmith's focus is a small, editable artifact and a bounded local resolver whose decision you can inspect. See the [primary-source research](docs/research.md) for comparisons with Playwright, Puppeteer Replay, workflow-use, Browser Use, Stagehand, and others.

## CLI that stays out of the way

```sh
# With the studio running, use the local example
replaysmith example -o dispatch.json
replaysmith run dispatch.json --input note='Ship the calibration kit to Avery.' --report run.json

# Import a supported Chrome Recorder JSON file and inspect the generated inputs
replaysmith import recording.json -o task.json
replaysmith inspect task.json

# Or record directly in a fresh browser
replaysmith record https://example.org -o recorded.json

# Export a frozen executable or an Agent Skill directory
replaysmith export task.json --format playwright -o workflow.mjs
replaysmith export task.json --format skill -o exported-skills
```

Output paths must be new; existing files are never silently overwritten. Run exit codes are `0` for a verified outcome, `2` for abstention or an unverified run, and `1` for failure or invalid input. Secret runtime inputs can be passed as JSON through `--inputs-stdin`.

The [workflow guide](docs/workflows.md) covers input preparation, meaningful assertions, sensitive actions, reports, and exports. [Example workflows](examples/) include an ordinary run, changed IDs, and a reused-ID trap on the local demo page.

## Measured, with limits

The [published benchmark](docs/benchmarks.md) uses **11 controlled local scenarios, four policies, and three repetitions: 132 real Chromium trials**. It reads the fixture's actual saved value and wrong-action counters independently of the run report. All baselines have the same per-operation timeout; semantic playback is an ordinary exact Playwright locator baseline.

| Policy | Changed tasks completed | Wrong-action trials | Safe stops on refusal cases |
| --- | ---: | ---: | ---: |
| Recorded selectors | 0 / 15 | 3 / 33 | 12 / 12 |
| Exact semantic locators | 12 / 15 | 0 / 33 | 12 / 12 |
| First-match text heuristic | 12 / 15 | 6 / 33 | 6 / 12 |
| ReplaySmith | 15 / 15 | 0 / 33 | 12 / 12 |

ReplaySmith explicitly abstained in all 12 refusal trials and rejected the corrupted outcome in all three trials. Baseline safe stops include strict-locator errors and timeouts; these are safety successes too. The simple heuristic sometimes clicked a decoy, which the wrong-action metric exposes even when click execution succeeds. Completion alone is insufficient.

This developer-authored suite is synthetic, small, and not held out. It demonstrates these supported mutations, not arbitrary website reliability or superiority over complete competitor products. It also publishes timing overhead: the guarded resolver is generally slower than an exact locator on the unchanged fixture. Read the [raw results](benchmarks/results.json), [method](docs/benchmarks.md), and [runner](benchmarks/run.ts).

```sh
npm test
npm run bench                       # three repetitions; writes fresh results
npm run bench -- --repetitions 1    # shorter local/CI check
```

## What v0.1 supports

Supports Chromium, native/ARIA element interactions, one-page workflows, explicit inputs, bounded semantic recovery, and exact outcome assertions. Chrome Recorder import supports navigation, primary element clicks, changes, simple key presses, and navigation assertions.

It does not support frames, multiple tabs, file transfers, drag-and-drop, shadow-host selector chains, arbitrary JavaScript imports, or arbitrary synonym/redesign recovery. HTTP navigation redirects are blocked in this release. Accessible-name evidence is an approximation, not the complete WAI-ARIA algorithm. See [core boundaries](docs/core-notes.md).

Workflows are executable instructions. Review them and their origin list before running. Origin checks constrain navigation; page scripts and subresources can still make other network requests. Automatic sensitive detection and secret masking are aids, not complete classifiers. See [SECURITY.md](SECURITY.md) before handling private or consequential tasks.

## Under the hood

![ReplaySmith architecture](assets/architecture.svg)

One TypeScript/Node library, Playwright, and a dependency-free studio. No second browser framework, database, orchestration platform, model download, or custom ML. The [architecture note](docs/architecture.md) maps the diagram to source modules. The [launch composition](demo/) and [capture script](scripts/capture-demo.ts) preserve how the demo was made.

MIT licensed. Reproducible bug reports and focused changes are welcome through [issues](https://github.com/nazeeh111/ReplaySmith/issues) and [contributions](CONTRIBUTING.md).
