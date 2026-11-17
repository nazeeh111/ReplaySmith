---
name: matched-continuation-witness
description: "Replay the matched continuation witness browser workflow with explicit inputs, origin restrictions, and outcome verification. Use when the user requests this recorded task."
---

# matched continuation witness

Run the recorded workflow only for a user-authorized task. Review [workflow.json](workflow.json) before execution.

## Setup

From this skill directory, use a local Node.js 22+ environment:

```sh
npm install
npx playwright install chromium
```

## Run

```sh
node scripts/run.mjs --inputs '{}'
```

Pass input values as a JSON object through `--inputs`. For private values, use `--inputs-stdin` to read JSON from standard input instead of exposing it in process arguments. Required inputs without defaults must be supplied. Use `--timeout-ms 15000` for slower pages; the default is 5000 milliseconds and the accepted range is 100 to 60000. Do not store secrets in this skill or commit run artifacts containing private data.

Consequential actions require separate user authorization and `--allow-sensitive`. They use exact recorded selectors and never semantic recovery. Stop if execution abstains or an assertion fails; inspect the target before editing the workflow. Do not weaken safeguards to force completion.

## Verify

Success requires `status: passed`. A verified outcome additionally requires `verified: true`; a run without trailing outcome assertions is not verified. Outcome verification does not prove target identity: native action dispatch is not atomic with the identity checks. Inspect post-action identityObservation and warnings, as well as candidate scores when recovery was attempted. A changed observation may be an expected effect or a wrong action; an unobservable one is unknown. Assertions may run after either, but a later action stops before dispatch. Inspect page state; the earlier action already occurred.

## Inputs

This workflow has no parameter inputs.
