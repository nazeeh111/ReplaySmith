# Workflows you can inspect

ReplaySmith stores one versioned JSON document. It contains explicit origins, named inputs, a sequence of actions, semantic evidence, and outcome checks. It contains no JavaScript. Review the document before running it, especially when it came from someone else.

## Record or import

In the studio, choose **Record**, enter an HTTP(S) URL, and demonstrate your task in the fresh Chromium window. The recorder captures one tab on one origin. Use **Assert text**, then click the result text to make it an outcome check. Choose **Stop & review** to bring the recording back to the studio. The CLI can record the same way:

```sh
replaysmith record https://example.org -o new-task.json
```

The recording browser is separate from your regular profile. It has no saved sign-ins. Cross-origin navigation and HTTP redirects are blocked in this first release. Recordings should stay within a single origin and supported native or ARIA controls. File upload/download, drag and drop, canvas coordinates, frames, and multiple tabs are outside this recorder's scope.

Export a Chrome DevTools Recorder recording as JSON, then use **Import recording**, or:

```sh
replaysmith import recording.json -o imported.json
replaysmith inspect imported.json
```

Import and recording automatically turn captured form values into named input defaults. When a text/value check contains the exact same literal once, preparation inserts that parameter into the check too. Review these substitutions and add checks for any derived or transformed result. The importer supports navigation, primary element clicks, changes, simple key presses, and navigation assertedEvents. It rejects unsupported actions and selector chains explicitly. See [core boundaries](core-notes.md#import-scope). Imported recordings may contain private literals; inspect them before saving or sharing.

## Make inputs reusable

Captured values already appear as named inputs after import or recording. For a literal fill or select step you add or edit later, use **Make input**. Name it after the data it represents, such as `query`, `note`, or `region`. The literal becomes a default and the step value becomes `{{note}}`. Secret parameters discard the stored default and require a runtime value.

```sh
replaysmith parameterize literal-task.json --step step-2 --name note -o reusable.json
replaysmith run reusable.json --input note='A different dispatch note'
```

Automatic preparation substitutes an unambiguous captured literal in text/value checks. For manual parameterization or transformed results, edit the check to use the input too. For example, change `Draft saved: Original note` to `Draft saved: {{note}}`. ReplaySmith does not infer the business relationship between unrelated values.

For private values, use a JSON input object through stdin so the values do not appear as command-line arguments:

```sh
replaysmith run private-task.json --inputs-stdin < private-inputs.json
```

Keep that private input file outside version control. Secret masking cannot recognize every form of personal information.

## Define the outcome

Add a final outcome check after the last action. Use an exact element text, input value, URL, or visible element. Text checks use normalized DOM `textContent`, the same text captured by the recorder; hidden descendant text, such as heading permalink markers, is included. A good check expresses the task result, such as the exact saved note or an order's draft status. A visible submit button is usually a weak check.

A run can report `status: passed` with `verified: false` if it has no trailing outcome checks. CLI and generated scripts exit successfully only when both the steps and outcome verification pass. Exit `2` means abstention or an unverified run; exit `1` means failure or invalid input. The run report includes the strategy used for each target and the top recovery candidates when ranking was needed.

## Understand recovery

Replay uses a recorded selector only when its available semantic evidence is compatible. Next it tries exact Playwright role, label, test-ID, placeholder and text locators. When those cannot identify one element, it ranks visible candidates using recorded evidence and surrounding context.

A candidate must score at least `0.78` and lead the next candidate by at least `0.12`. These scores are heuristics, not probabilities. Inspect the reported reasons before changing evidence. Recovery supports bounded structural and wording changes; it does not understand arbitrary synonyms, visual redesigns, business intent, or every accessible-name rule.

A missing, disabled, ambiguous or weak target causes an abstention. A click whose outcome check fails causes a failed run. ReplaySmith does not repeat the click to try to make the assertion pass.

Mark consequential actions as sensitive before replay. They require explicit permission and a compatible exact recorded selector; recovery is disabled. The automatic guard catches common action words and types, but cannot classify every business operation or language.

## Export

```sh
replaysmith export reusable.json --format playwright -o workflow.mjs
replaysmith export reusable.json --format skill -o exported-skills
```

The Playwright export is an executable ES module embedding the same runtime, workflow and scorer. It needs Playwright and Chromium, but does not need ReplaySmith:

```sh
npm install playwright@1.64.1
npx playwright install chromium
node workflow.mjs --inputs '{"note":"A different note"}'
```

The skill export creates `exported-skills/<workflow-slug>/`, with a matching `SKILL.md` name, workflow JSON, a pinned package manifest, and `scripts/run.mjs`. The studio downloads this directory as a ZIP. Read the skill before installing it in an Agent Skills host. Filesystem export does not register it with a marketplace or authorize an agent to perform the task.

Re-export after changing the workflow or upgrading ReplaySmith: each export freezes that version's behavior.

For slower pages, CLI replay and both exported scripts accept `--timeout-ms 15000`. The default operation timeout is 5000 milliseconds; valid integer values are 100 through 60000. A timeout remains a failure or safe abstention, never successful verification. API users can set `timeoutMs` in run options.
