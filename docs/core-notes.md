# Core behavior and boundaries

ReplaySmith's runtime is a deterministic Playwright program. The standalone Playwright export embeds the same runtime and evidence scorer. Agent Skills contain that script plus workflow.json and a specification-compatible SKILL.md. No inference service, model download or paid API is used.

## Evidence and recovery

Selector matches are checked against recorded semantic evidence when identifying evidence is available. A recycled selector whose element conflicts with the fingerprint is rejected. Semantic alternatives are tried next. Finally, visible candidate elements receive an inspectable weighted token-overlap score. Fields include role, name, label, text, test ID, placeholder, input type, link destination and the named surrounding form/section/group. Role or input-type conflicts disqualify a candidate. Recovery requires score >= 0.78 and a lead >= 0.12 over the next candidate. These constants are heuristics, not calibrated probabilities; no trained model or universal reliability claim is made.

Recovery supports small wording changes, changed IDs/structure, accessible alternatives and named surrounding context. It cannot infer arbitrary synonyms or site intent. Fingerprinting approximates a subset of accessible-name computation; it is not the full WAI-ARIA algorithm. Missing, ambiguous, disabled or low-evidence targets cause abstention. A bounded polling loop waits for late controls. Playwright still performs its normal actionability checks.

## Outcomes

A run with all actions completed can have status `passed` while `verified` is false. Verification additionally requires at least one successful trailing assertion after the last action. Text and value assertions use exact values (text normalizes whitespace), URL assertions use exact full URLs, and visible assertions require one visible matched element. Users must choose a meaningful business outcome; the runtime cannot prove that a weak assertion expresses the intended task.

## Safety boundary

Review imported workflow JSON before running. Workflows are code-like instructions, even though they cannot contain JavaScript. Navigation uses a literal HTTP(S) origin allowlist. Credentials in URLs and parameterized origins are rejected. HTTP navigation redirects (including same-origin redirects), cross-origin navigations and popup navigation requests are blocked; popup pages are closed. The browser starts with a clean ephemeral context and service workers blocked. ReplaySmith does not access the user's normal browser profile or credential stores.

Enter in a form-associated field and clicks on form-associated submit controls are conservatively treated as consequential, even when their labels are neutral. Steps explicitly marked sensitive, password targets, and a conservative list of consequential action words require `allowSensitive`. Consequential targets never use semantic or scored recovery. All runtime strategies retain evidence checks and safety guards; benchmark baselines are implemented independently. Use a final, non-redirecting URL in workflows. This is a conservative aid, not a complete classifier of financial, destructive, or externally visible actions. Mark consequential steps explicitly and authorize the real task separately. A page may perform requests as a side effect of an allowed action; the origin guard is not a network sandbox or a substitute for reviewing a workflow/site.

Secret inputs cannot store defaults. Secret parameterization drops the literal and requires a runtime value. Reports omit input values and Playwright call logs. Browser page text in candidate evidence, imported literal defaults, screenshots produced by users, and workflow URLs can still contain private information; inspect them before sharing.

## Import scope

Chrome DevTools Recorder `navigate`, primary single `click`, `change`, simple key presses (using their recorded selector or the preceding focused target) and navigation assertedEvents are supported. Recognized private change values become required secret inputs, discarding their literals. Viewport entries are ignored as presentation state; matched keyUp entries correspond to the release already performed by a press. Frames, secondary targets, multi-segment/shadow selector chains, right/double clicks, modifier sequences and unsupported actions fail explicitly. Import does not flatten a shadow/ancestor selector chain into an unrelated leaf selector. A `change` targeting a native select is executed as selectOption at runtime. Full recordings with unsupported operations should be simplified or authored as workflows.

## Export maintenance

The exported script freezes the workflow and engine behavior at export time. Re-export after updating a workflow or ReplaySmith version. The Agent Skill is portable filesystem content; no upload, marketplace registration or external agent execution is implied by export.
