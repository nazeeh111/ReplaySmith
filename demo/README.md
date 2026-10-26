# ReplaySmith launch media

The silent 22-second launch clip uses actual captures of this product running against the bundled dispatch-desk fixture. It is an edited sequence of recorded states, not a real-time screencast. No result, timing, candidate score, or successful action in the screenshots was fabricated.

## Source and provenance

- `launch-v1/composition/index.html`: editable Hyperframes composition, 1920 × 1080 at 30 fps.
- `launch-v1/composition/DESIGN.md`: studio-derived visual identity and scene decisions.
- `launch-v1/captures-v2/`: current successful capture, original native recording, prepared workflow, actual run reports, exports, and `provenance.json`.
- `launch-v1/checks/`: renderer checks and final media verification.
- `../assets/demo.mp4` and `../assets/demo.gif`: final launch video and compact README preview.

The script genuinely records typing, clicking Save draft, and selecting an outcome through ReplaySmith's native recorder. It then imports that saved recording through the studio, observes automatic named-input preparation, edits descriptions and run data, runs and verifies the changed input, tests a recycled-ID fixture, demonstrates abstention on duplicate controls, restores and verifies the workflow, and downloads its real exports. All values are fictional. Loopback addresses in capture artifacts belong to the temporary local fixture, which closes when capture completes.

The page mutations are controlled fixtures. These screenshots demonstrate supported behavior on those cases; use the independent benchmark suite for its bounded comparison results.

## Recreate the captures

From the repository root with Node.js 22+ and the project's dependencies installed:

```sh
npx playwright install chromium
npm run demo -- --out demo/captures-new
```

The output destination must be absent. `--publish-stills` updates the four published studio screenshots only after the complete capture succeeds. A failed capture preserves the last successful published stills. The installed Chromium browser and a loopback listener are required; the script uses a fresh browser profile.

## Re-render the composition

Copy the referenced successful PNG captures into a new copy of `launch-v1/composition/assets/` when replacing the demonstrated states. Preserve the previous valid output while editing. The composition uses local image assets, local font declarations (Helvetica Neue and Menlo on the original macOS render host, with generic browser fallbacks), and a vendored GSAP runtime. It contains no audio or external media references.

The original build used the installed, pinned Hyperframes 0.8.33 local runner, system Chrome, and FFmpeg. With that runner available:

```sh
python3 /path/to/hyperframes-local/local.py lint /absolute/composition --json
python3 /path/to/hyperframes-local/local.py check /absolute/composition --json --samples 9
python3 /path/to/hyperframes-local/local.py render /absolute/composition --output /absolute/new-demo.mp4 --fps 30 --quality standard --workers 1
ffprobe -v error -show_streams -show_format /absolute/new-demo.mp4
ffmpeg -v error -i /absolute/new-demo.mp4 -f null -
```

The local runner is a host-specific development convenience, not a ReplaySmith dependency. Another compatible Hyperframes renderer can use the editable composition. Render to an absent output path, inspect transitions and settled frames, and retain the previous valid render until its replacement has succeeded.

The 21.2-second preview GIF is derived from the verified MP4 with FFmpeg palette generation and optimized frame changes. Its first 0.8 seconds are trimmed so the initial thumbnail is readable; the complete 22-second MP4 retains all entrances. The preview is 900 × 506 at 10 fps; the MP4 is 1920 × 1080 at 30 fps.

```sh
ffmpeg -n -ss 0.8 -i new-demo.mp4 -filter_complex "[0:v]fps=10,scale=900:-1:flags=lanczos,split[a][b];[a]palettegen=stats_mode=diff:max_colors=160[p];[b][p]paletteuse=dither=bayer:bayer_scale=3:diff_mode=rectangle[out]" -map "[out]" -gifflags +transdiff -loop 0 new-demo.gif
```

The final local lint, runtime, nine-sample layout, and five-sample contrast checks passed. The runner's optional motion-audit module was disabled, so it is not counted as a successful motion audit. Actual encoded output was fully decoded and representative transition and settled frames were visually inspected.

## Licenses

Screenshots, composition code and ReplaySmith branding are part of this MIT-licensed project. The demo-only vendored GSAP 3.14.2 runtime retains its original notice and its separate Standard no-charge license, reproduced in `composition/assets/GSAP-LICENSE.txt`. It is not a dependency of the browser automation runtime.
