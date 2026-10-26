# Workflow studio

A local, dependency-free workbench served by `replaysmith studio`. The interface uses warm paper, ink, and orange tooling accents, a numbered step rail, inspectable element evidence, and an explicit outcome-check note. No stock photography, external fonts, CDN scripts, fabricated metrics, or persisted browser state.

## Functional surface

- Import Chrome DevTools Recorder or ReplaySmith JSON via picker or file drop.
- Load the server's working local example without claiming it has run.
- Record a new demonstration in a headed browser through `/api/record`.
- Inspect and edit step descriptions, URLs, input values, keys, sensitive flags, selectors, evidence, and assertions.
- Imported and newly recorded fill/select values automatically become named inputs with defaults. Unique matching literal assertions are linked to those inputs. A literal fill can also be parameterized explicitly with `/api/parameterize`.
- Add explicit outcome checks; edit the origin allowlist.
- Run in a fresh browser; view real status, duration, recovery candidates and reasons, or failures/abstentions.
- Edit and validate complete JSON source.
- Download workflow JSON, Playwright code, and Agent Skills ZIP containing every export file. ZIP uses uncompressed standard records and CRC32, with no additional dependency.

## API contract

| Endpoint | Request | Response |
| --- | --- | --- |
| `GET /api/example` | none | `Workflow` |
| `POST /api/import` | `{recording}` | `Workflow` |
| `POST /api/validate` | `{workflow}` | `Workflow` |
| `POST /api/parameterize` | `{workflow,stepId,name}` | `Workflow` |
| `POST /api/run` | `{workflow,inputs,allowSensitive}` | `RunResult` |
| `POST /api/record` | `{url}` | `{workflow}` or `Workflow`, when recording stops |
| `POST /api/export` | `{workflow,format:'playwright'|'skill'}` | `{files:Record<string,string>}` |

Error responses should use `{error:string}` or `{error:{message:string}}`. Workflow responses may also be wrapped as `{workflow}`. Run results may also be wrapped as `{result}`.

## Privacy and safe display

Imported text, workflows, results, and error messages render with DOM `textContent`, never `innerHTML`. No localStorage or sessionStorage, analytics, remote assets, or external execution services. Input values remain in memory. Secret input definitions render password fields. All meaningful changes clear the previous run report. Exports only use explicit server-returned files and sanitized download paths.

## Accessibility

Native controls and dialogs; labels for editable fields; live status notice; keyboard tab navigation with arrow/Home/End controls; visible focus; reduced-motion support; responsive horizontal step rail on narrow screens. The studio warns that recording and imported actions need review and that passing clicks alone does not verify an outcome.

## Verified acceptance

The real `tests/studio.test.ts` starts the actual loopback server and drives Chromium without mocked API responses. It exercises a changed-input verified demo, Recorder import, automatic input preparation, step editing, manual parameterization, a final assertion, verified replay, actual Playwright and Agent Skills downloads, invalid-source preservation, and a narrow viewport with no horizontal overflow or page script errors. The ZIP extracts into the name declared in SKILL.md. Pending editor/source changes are applied before run or export.
