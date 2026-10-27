# Third-party notices

ReplaySmith source and original artwork are MIT licensed. No implementation code from the researched competitors was copied into this project.

- **Playwright**, Microsoft contributors, Apache-2.0. Browser automation runtime. Distributed as an npm dependency with its own license and notices: https://github.com/microsoft/playwright/blob/main/LICENSE. Its downloaded browser binaries have separate third-party terms retained by the browser installer.
- **TypeScript**, Microsoft contributors, Apache-2.0; **tsx**, Hiroki Osame and contributors, MIT; **@types/node**, DefinitelyTyped contributors, MIT. Development dependencies retain their package licenses. tsx uses esbuild (MIT).
- Chrome DevTools Recorder JSON and the Agent Skills specification are interoperable formats. ReplaySmith implements a documented subset of the former and exports the latter. Their documentation is linked in docs/research.md.

The launch media uses the actual ReplaySmith interface and fictional local demo data. SVGs, demo fixtures, screenshots, and composition source are original project assets. System fonts are referenced; no font binaries are redistributed.

## Demo-only animation dependency

The editable launch composition vendors **GSAP 3.14.2**, © GreenSock, under the GSAP Standard License, not MIT. It is used only to render launch media and is not a ReplaySmith runtime dependency. Its original header, license text, and notice are retained beside the demo asset; see `demo/launch-v1/composition/assets/`. Terms: https://gsap.com/standard-license/.
