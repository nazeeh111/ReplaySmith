# Recording and replay on public websites

ReplaySmith v0.1.1 was tested beyond its local demo on five independently hosted websites. Python and Playwright are production documentation sites; Books to Scrape, TodoMVC and The Internet are public practice applications. These are small acceptance checks, not a general reliability percentage or permission to automate arbitrary sites.

## Tasks and outcomes

On 29 October 2026, the final suite passed all eight workflows. All 11 API replays (eight normal and three with local layout changes) verified their outcomes; all 22 actual export processes exited successfully with verified outcomes. Each navigation recovery check used recovery, and the independent page checks passed. No acceptance retries were used in this final run. The earlier failed attempts remain documented below and in the compact evidence report.

| Website | Demonstrated task | Independent API outcome check |
| --- | --- | --- |
| [Books to Scrape](https://books.toscrape.com/) | Open the Travel category and capture its heading | One Travel main heading |
| [Python documentation](https://docs.python.org/3/) | Open Tutorial and capture its heading | One Python Tutorial main heading |
| [Playwright documentation](https://playwright.dev/docs/intro) | Open Locators and capture its heading | One Locators main heading |
| [TodoMVC React](https://todomvc.com/examples/react/dist/) | Create a todo, filter Active, complete it, filter Completed, capture the label | Changed input appears in the completed list and its checkbox is checked |
| [The Internet: dropdown](https://the-internet.herokuapp.com/dropdown) | Select Option 1, improve the outcome to a value check, replay Option 2 | Selected value is `2` |
| [The Internet: dynamic controls](https://the-internet.herokuapp.com/dynamic_controls) | Enable a disabled input, fill it, capture the enabled message | Input is enabled and contains the changed value |
| [The Internet: dynamic loading](https://the-internet.herokuapp.com/dynamic_loading/2) | Start loading and capture the delayed result | Visible `Hello World!` |
| [The Internet: checkboxes](https://the-internet.herokuapp.com/checkboxes) | Check the first box and add an explicit checked-state outcome | Both checkboxes are checked |

Each task starts with the actual native recorder in a fresh Chromium profile, goes through input preparation or an explicit outcome improvement, and runs again with outcome verification. Both generated artifacts are executed as separate Node processes: standalone Playwright JavaScript and the Agent Skill's `scripts/run.mjs`. Changed inputs are used where the task has data inputs. The checkbox improvement uses a visible `:checked` selector with empty recovery evidence, so an unchecked box cannot be recovered into a successful check. The recorder's text picker does not infer checkbox state.

For the three navigation tasks, an additional replay locally wraps the recorded link in a new DOM element, changing its CSS path. Both exports are also run with deliberately stale click selectors. Recovery must actually be used and the final heading must verify. These changes affect only isolated browser DOMs or recorded workflows; hosted websites are never changed. API checks inspect the page independently; export completion relies on each generated workflow's trailing assertion and process status.

All API runs and exported runs in the final live suite explicitly use a 15,000 ms operation timeout. Exports and the CLI retain a 5,000 ms default, configurable with `--timeout-ms` from 100 to 60,000. Slow networks may require a larger budget. Browser startup and the complete workflow have separate harness limits.

## What the tests found

The released v0.1.0 tarball was preserved and tested before the fixes. That reproduced these problems:

- Nested TodoMVC heading context was captured differently during recording and replay, rejecting the correct Active filter link.
- An unnamed dropdown gained an invented name from its option text during recording, then failed target matching.
- A field that enables asynchronously caused an immediate safe refusal before it became usable.
- Python documentation heading capture included a hidden permalink marker while replay read visible text, so the exact outcome failed.
- Native outcome picking intermittently omitted the final assertion on Playwright documentation. Window-only click capture still missed one of three later recordings.
- When the documentation site's initial and hydrated layouts differed, CSS heading paths changed. Recovery safely refused because the main heading and lower-level headings were too similar.

A later candidate also exposed an overly broad heading fallback: a delayed target without identifying context could resolve to another heading of the same level. Heading level alone now cannot authorize semantic recovery; exact recorded targets continue to be polled while absent.

The fixes share one evidence extractor across capture, replay and exports; wait for asynchronously enabled controls while rechecking identity and permissions; consistently compare normalized DOM text; capture picked outcomes before mouse handlers can replace targets; drain outstanding captures before Stop; and preserve native heading level in semantic matching and ranking. Recovery collects visible-candidate evidence in one browser round trip using Playwright visibility filtering, and refuses a candidate pool whose inspection exceeds its time budget. Confidence and ambiguity thresholds remain 0.78 and 0.12.

The precise cause of the intermittent production-site capture loss was not established. Deterministic tests reproduce window-level event interception, mouse-driven target replacement and delayed acknowledgements. An independent review also exposed a Stop-drain rejection edge; the fix waits for every outstanding capture even if another capture rejects. These tests target observed failure classes without claiming a universal explanation for every site event sequence.

The final build captured the correct trailing `Locators` text assertion in all three fresh, uninstrumented Playwright documentation recordings. All three trials and runtime hashes are retained. This bounded check is not a capture reliability rate.

## Reproduce

Use Node 22+, install the checkout's dependencies and pinned Chromium, then run:

```sh
npm ci
npx playwright install chromium
npm run test:live -- --out artifacts/live-web/my-new-run
```

The output directory must be new. The suite saves native/prepared workflows, run reports, export scripts, screenshots and runtime hashes. It exits nonzero when a task, independent outcome, recovery check or export fails. External outages and timeouts count as failed or unavailable, never success. This opt-in network suite is separate from deterministic CI. It creates only browser-local test data and uses public navigation/test controls, without accounts, purchases or messages.

The compact [published evidence](../benchmarks/real-websites.json) records outcomes, timestamps, source/build hashes and earlier failures. Full copied third-party pages are intentionally excluded from the repository. See also the [controlled benchmark](benchmarks.md), [release validation](validation.md) and [workflow boundaries](workflows.md).

Existing recordings with inconsistent v0.1.0 evidence should be re-recorded and reviewed. No stored workflow is silently rewritten to relax target matching. Native accessible-name extraction remains an approximation. Frames, multiple tabs, HTTP redirects and arbitrary semantic changes remain unsupported. Passing these eight workflows establishes these specific observations, not broad arbitrary-website reliability.
