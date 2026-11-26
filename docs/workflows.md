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

Add a final outcome check after the last action. Use an exact element text, input value, URL, visible element, or native checkbox/radio state. A value check may expect the empty string to verify that a field was cleared. A `checked` or `unchecked` assertion has a target and no value; it reads the native checked state and rejects an indeterminate state. It does not click or toggle the control. Both state checks require a visible native checkbox or radio input; missing, ambiguous or hidden targets abstain, and a different control type fails. An unchecked control is not established by a missing element. Studio provides both checks in the outcome dialog and step editor; Playwright and skill exports embed the same behavior. Text checks use normalized DOM `textContent`, the same text captured by the recorder; hidden descendant text, such as heading permalink markers, is included. A good check expresses the task result, such as the exact saved note or an order's draft status. A visible submit button is usually a weak check.

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

The budget belongs to one step, not to each retry: selector inspection, recovery,
readiness, the browser action and assertion polling share the original deadline.
The next step gets its own budget. An expired resolution abstains without acting;
an action that has already been dispatched can fail after having an effect. Inspect
the page before retrying a failed action. ReplaySmith never repeats it automatically.

SDK callers can cancel a run without closing a caller-owned page:

```ts
import { runOnPage } from 'replaysmith';

const controller = new AbortController();
const pending = runOnPage(page, workflow, {
  timeoutMs: 5000,
  signal: controller.signal,
});
// Call from the caller's Stop handler when cancellation is requested:
controller.abort();
const report = await pending;
```

Cancellation before dispatch abstains. Cancellation during a browser action fails
conservatively and cancels Playwright's pending operation, but does not undo an
already committed click, request or input. Cancellation reasons are not included
in reports. Already-running page JavaScript and browser reads without native
cancellation support may finish after the deadline; the runtime rechecks the budget
before any subsequent action or successful verification. The timeout is therefore
an action/verification boundary, not a guarantee of exact wall-clock return time.

Input actions retain one exact DOM node after resolution and readiness. Playwright
can wait and retry on that node, but cannot silently switch to a replacement with
the same selector. Native actionability checks revalidate the recorded identity
evidence and consequential-action permission while click, fill and select wait.
The temporary native handler and node handle are released before the step ends;
caller-owned handlers are retained. Keyboard press is checked immediately before
its exact-node dispatch; it has no inner actionability retry loop.

These checks are not an atomic browser transaction. They do not cover every
possible page mutation after the final native check, changes not distinguished by
the recorded evidence, or the effects of already-dispatched input events.

Cancellation also reaches the navigation guard's separate fetch. Cleanup stops
new owned work, waits for its active handlers and disposes fetched responses;
a stopped guard does not start response fulfillment. Caller pages and contexts
are not closed. An already-dispatched navigation is not rolled back: cancelling
its wait does not promise the page will remain unchanged, and inspecting the page
immediately after cancellation cannot establish that it will never change later.

### Native action identity observation

Native browser actions have pre-dispatch checks, followed by a separate observation of the selected element where available. Completed element actions that reach the observation stage report `identityObservation`: `matched`, `changed`, or `unobservable`. Navigation steps and actions that fail before that stage omit it. Changed evidence is ambiguous: the action itself may have changed the element, or a different action may have occurred. After a changed or unobservable observation, read-only assertions may run, but the next action is stopped before dispatch with an abstained result. A passing assertion does not clear the uncertainty. Inspect page state before retrying; the earlier action already occurred. If no later action is requested, final outcome checks can still pass, but they do not prove target identity. Navigation or detachment may make the element unobservable.

These observations are not atomic with dispatch and cannot guarantee the target or undo an effect. `verified` means the workflow's explicit outcome assertions passed; it does not verify target identity. Generated standalone and Agent Skill exports use the same runtime and limits. A known native action race can produce a wrong effect between the precheck and dispatch.

### Bind DOM activation to recorded evidence

For a page you control, use `"action": "activate"` in the workflow JSON when the app supports a synthetic click. The target needs one simple ID selector. Other recorded selector alternatives are ignored. Preserve the recorded tag, type, role and name and any other evidence. For example:

```json
{
  "id": "open-preview",
  "action": "activate",
  "target": {
    "selectors": ["#preview"],
    "evidence": { "tag": "button", "type": "button", "role": "button", "name": "Preview" }
  }
}
```

The browser checks that the ID is unique and that every recorded evidence field exactly matches the same element it activates, in one synchronous operation on the top-level document. Supported controls are visible, enabled `button[type=button]` and `input[type=checkbox]` with an unobstructed center in the viewport. The runner abstains on missing, ambiguous, changed, unavailable, unsupported or identified consequential controls. The step never retries through native input or semantic recovery.

Activation directly calls the control's DOM click behavior. It emits an untrusted click and supplies no pointer sequence, keyboard input, focus change or browser user activation. Use the native actions when the page depends on those behaviors. The binding assumes ordinary page DOM behavior and distinguishes controls by the evidence the recording contains. It cannot distinguish a replacement with identical evidence or establish what handlers do with the event. Outcome assertions remain necessary. CLI, Studio and standalone exports share the implementation.

Studio enables this check for the first targeted action by default. In the Workflow tab, uncheck **Require a matching first target** to allow native input for one run. For an existing recording, `replaysmith run task.json --require-first-target-identity` checks the first targeted action without editing the workflow. It uses DOM activation for a qualifying first `click` or `activate`, and abstains on unsupported input before it can dispatch. The first-target option leaves navigation, assertions and later actions under their recorded rules. Use `requireFirstTargetIdentity: true` in the Node runner or the same CLI flag when running a newly generated standalone script. Use this option only for apps that support synthetic clicks.
