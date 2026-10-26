# Architecture

![ReplaySmith architecture](../assets/architecture.svg)

One Node process serves the studio and executes the same library used by the CLI. The browser runtime is Playwright. There is no backend database, extension build, inference service, training job, or paid API.

| Module | Responsibility |
| --- | --- |
| `src/recorder.ts` | Fresh browser, captured actions and fingerprints, local recorder controls |
| `src/importer.ts` | Explicit Chrome Recorder subset; fail on unsupported semantics |
| `src/workflow.ts` | JSON validation and explicit parameterization |
| `src/recovery.ts` | Portable weighted token-overlap scoring and explanations |
| `src/runner.ts` | Origin/action guards, target resolution, browser actions, outcome checks |
| `src/exporter.ts` | Freeze the runtime into runnable Playwright and Agent Skill files |
| `src/server.ts` | Loopback-only studio API, bounded JSON, cross-site request protection |
| `studio/` | Inspectable workflow editing and real run reports; no remote assets |
| `benchmarks/run.ts` | Independent playback baselines and instrumented local fixtures |

A step resolves an element, checks action permissions, performs the action once, and records its result. Assertions observe page state. A failed assertion never causes the preceding action to retry. A run stops at the first abstention or failure. Browser contexts close after the run, including failures.

The exported module embeds the same runtime and evidence scorer rather than translating safeguards into a weaker chain of selectors. Export parity is exercised in real Chromium tests. Agent Skills wrap that script with a named directory, installation instructions, input definitions and a workflow artifact.

The diagram's SVG is editable source. It depicts the implementation, not planned functionality. The [research note](research.md) explains why Playwright was reused and where ReplaySmith overlaps existing tools. The [security note](../SECURITY.md) describes the boundary of its guards.
