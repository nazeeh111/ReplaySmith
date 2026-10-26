# Research and product boundaries

Reviewed 26 October 2026. This is a primary-source review of documentation, source schemas, licenses, and issue reports. Competitor behavior was **not** independently executed. Repository default branches and open-issue status can change. ReplaySmith's own benchmark results belong in the benchmark report, not this comparison.

## The useful gap

Recording actions, semantic locators, generated scripts, and AI-assisted recovery already exist. ReplaySmith's useful focus is a small, inspectable workflow artifact with local execution, editable inputs, explicit outcomes, and conservative recovery that explains its evidence or stops. It should not claim to invent self-healing, nor promise arbitrary redesign recovery.

Playwright supplies browser control, actionability checks, and locator machinery. Reuse it rather than combining a second browser framework. Deterministic evidence ranking is a reasonable first implementation; adding a model would need to beat it on independently defined tasks while preserving abstention behavior.

## Existing approaches

| Tool | What its primary sources establish | Implication for ReplaySmith |
| --- | --- | --- |
| [Playwright](https://github.com/microsoft/playwright) | [Codegen](https://playwright.dev/docs/codegen) records actions and supports visibility, text, and value assertions. [Locators](https://playwright.dev/docs/locators) prioritize user-facing attributes and explicit contracts; strict actions reject multiple matches. | Semantic locators and recorded assertions are strong existing features. Build on them. A comparison must include a semantic baseline, not just fragile CSS. |
| [Puppeteer Replay](https://github.com/puppeteer/replay) | Replays Chrome Recorder JSON, allows runner extensions, and transforms recordings to code. Its API has schema parsing and extension tests. | Import an explicit subset of the mature Recorder format. Do not describe this subset as full Puppeteer Replay compatibility. |
| [workflow-use](https://github.com/browser-use/workflow-use) | Describes deterministic variable workflows with Browser Use fallback, recording, and generated workflows. Its README warns that the project is early development and not recommended for production. | Deterministic replay plus recovery is an established direction. A narrower runtime without inference, a database, or extension build can reduce setup cost. This is a design inference, not a measured advantage. |
| [record-and-replay-skill](https://github.com/ugarchance/record-and-replay-skill) | Records browser/desktop evidence and asks an agent to create a skill. Browser evidence includes semantic selector alternatives and traces. Its privacy notes warn that traces can contain raw sensitive data despite heuristic event masking. | Demonstration-to-skill is established. Keep artifacts inspectable and avoid treating masking as a privacy guarantee. ReplaySmith can favor a portable executable workflow over an agent-interpreted recording. |
| [Browser Use](https://github.com/browser-use/browser-use) | Open-source agent library, local/cloud browsers, configurable models. Its FAQ permits local models through Ollama and distinguishes free library code from billed inference/cloud services. | Say ReplaySmith **requires no model**, not that alternatives cannot run for free. Task discovery by an agent and replay of a known task are different jobs. |
| [Stagehand](https://github.com/browserbase/stagehand) | Agent SDK with self-healing actions. Its [deterministic-agent guide](https://github.com/browserbase/stagehand/blob/main/packages/docs/v3/best-practices/deterministic-agent.mdx) describes caching after inference and fallback to fresh exploration. The [configuration reference](https://github.com/browserbase/stagehand/blob/main/packages/docs/v3/references/stagehand.mdx) exposes self-healing and model settings. | Cached/model-assisted recovery is a mature alternative worth acknowledging. ReplaySmith should make the different tradeoff of bounded local evidence with no inference dependency. No Stagehand timing claim has been reproduced here. |
| [Skyvern](https://github.com/skyvern-ai/skyvern) | AI browser workflows with extraction, validation, loops, and other orchestration blocks. Its [skill](https://github.com/Skyvern-AI/skyvern/blob/main/docs/skill.md) describes LLM/vision automation and cloud or self-hosted operation. | Broader orchestration is available. Keep ReplaySmith focused on a demonstrated browser task rather than recreating a workflow platform. |

## Reliability evidence and what it changes

These reports identify failure classes worth testing. They do **not** establish that every current release suffers the reported defect.

* [Playwright #30191](https://github.com/microsoft/playwright/issues/30191), opened 31 March 2024 against 1.42.0, reports a generated locator matching two elements. The issue closed without a public reproduction. [#21043](https://github.com/microsoft/playwright/issues/21043), from 2023, reports another generated-locator ambiguity. Treat these as practitioner reports, not a current codegen defect claim. Test duplicate controls and refuse to resolve ambiguity merely by choosing the first match.
* [Playwright's locator guidance](https://playwright.dev/docs/locators) explicitly warns that positional selection can target an unintended element after page changes. A selector that still matches is not proof of identity. Include selector reuse by a decoy in the mutation suite and check the captured semantic evidence before acting.
* [workflow-use #165](https://github.com/browser-use/workflow-use/issues/165), opened 10 August 2026, reports a zero-event recording, extension-loading conflicts, rejected incremental schema updates, and no-AI path initialization problems for a named environment/commit. This review did not reproduce it. Test recorder startup and nonempty capture, reject malformed imports clearly, and make the no-model path work without credential setup.
* [Puppeteer Replay #924](https://github.com/puppeteer/replay/issues/924), opened 29 November 2024, reports visibility-wait behavior inconsistent with expectations and missing test coverage. [#1050](https://github.com/puppeteer/replay/issues/1050), opened 15 October 2025, reports a navigation assertion timeout escaping a caller's catch. Test delayed outcomes, hidden matches, error propagation, and cleanup after failure rather than trusting a successful click.

The important distinction is between an action completing and the task's intended state being achieved. Outcome assertions should use exact expected content or values where possible. A workflow with no meaningful outcome check must be shown as unverified. Never repeat a consequential action merely because its postcondition failed: the first attempt may already have taken effect.

## Recorder import contract

The [Puppeteer Replay schema](https://github.com/puppeteer/replay/blob/main/src/Schema.ts) defines alternative selectors as an outer array. An inner multi-element array is an ancestor/shadow-host chain. Frames and page targets are separate semantics. Flattening a chain to its last selector changes the target and is unsafe.

The initial importer should accept only operations it can preserve faithfully, reject unsupported operations with the offending step identified, and distinguish layout metadata from actions. Do not evaluate imported expressions or arbitrary JavaScript. Unsupported frame, popup, shadow-chain, pointer-offset, or keyboard-pair behavior should be rejected or documented precisely. CSS, ARIA, XPath, and text syntaxes require explicit conversion, not a generic string replacement. Recorder navigation assertions are useful, but navigation alone often does not establish a business outcome; the studio should help add a final content/value check.

## Evaluation design

Use local pages so the original and mutated conditions are reproducible. Define the intended outcome and dangerous/incorrect action instrumentation independently of the resolver. Include unchanged control pages as well as changed IDs/classes, wrapper changes, repeated labels, partial wording changes, delayed rendering, missing targets, and selector reuse. Include cases that should remain unsolved.

Compare four declared policies under the same page state and timeout budget: ordinary recorded selector, exact Playwright semantic locator, simple text/label recovery, and ReplaySmith evidence ranking with ambiguity rejection. Publish per-case outcomes and denominators, wrong actions, abstentions, and elapsed time. Separate recovery opportunities from intentional refusal cases. A small controlled suite supports claims about those mutations only, not general website reliability. Keep threshold tuning cases separate from any held-out claims; do not call a hand-designed fixture set a real-world benchmark.

## Skill portability

The [Agent Skills specification](https://agentskills.io/specification) requires a directory with `SKILL.md`, YAML frontmatter, and Markdown instructions. `name` must match the directory, be at most 64 characters, use lowercase letters/numbers/hyphens, and avoid leading, trailing, or consecutive hyphens. `description` must be nonempty and at most 1024 characters. Executables can live in `scripts/`; workflow data can be bundled separately. State Node/Playwright requirements and input handling. Format compliance does not prove that every host will discover or authorize a skill, so verify the exported script separately.

## Licenses and reuse

No competitor implementation was copied during this review. Playwright is the intended runtime dependency; preserve the notices distributed with that package. The reviewed licenses are:

| Project | Reviewed license source |
| --- | --- |
| Playwright | [Apache-2.0](https://github.com/microsoft/playwright/blob/main/LICENSE) |
| Puppeteer Replay | [Apache-2.0](https://github.com/puppeteer/replay/blob/main/LICENSE) |
| workflow-use | [AGPL-3.0](https://github.com/browser-use/workflow-use/blob/main/LICENSE) |
| record-and-replay-skill | [MIT](https://github.com/ugarchance/record-and-replay-skill/blob/main/LICENSE) |
| Browser Use | [MIT](https://github.com/browser-use/browser-use) |
| Stagehand | [MIT](https://github.com/browserbase/stagehand) |
| Skyvern | [AGPL-3.0](https://github.com/skyvern-ai/skyvern) |

Schema interoperability and using a dependency do not imply importing a competitor's implementation. Any later copied source or asset needs its own provenance and license review.

## Presentation tools

[PaperVizAgent](https://github.com/google-research/papervizagent), formerly PaperBanana, is available under Apache-2.0. Its documented setup configures external model API keys. No free end-to-end model route was verified in this review. Executing it would add unneeded provider setup for a small architecture diagram, so a source-controlled SVG or Mermaid diagram is the proportionate route under the project's no-billed-API constraint. This is a tool-selection decision, not a claim that the project cannot support other backends.

The local `/brag` skill is installed and supports a product launch clip through local Hyperframes or an existing free native fallback. The demo should use fresh screenshots or captures of the running product, readable holds, and only verified claims. A polished animation cannot substitute for an actual successful workflow run.
