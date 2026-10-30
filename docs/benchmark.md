# Local Chrome performance comparison

`scripts/benchmark.mjs` compares the released single-thread core with the multi-thread core. It uses an isolated Chrome profile and a temporary loopback server with COOP/COEP headers. The media file remains local. This measures the conversion engine separately from the production service-worker bootstrap; the application needs its own smoke test.

Install the app dependencies, build the vendored assets, and supply a local WebM file. Playwright is a development-time prerequisite; either install it separately or set `PLAYWRIGHT_MODULE` to its `index.mjs`. Set `CHROME_PATH` to the installed Google Chrome executable. `ffprobe` and `ffmpeg` must be on PATH, or supplied through `FFPROBE` and `FFMPEG`.

```sh
node scripts/benchmark.mjs --input /path/to/clip.webm --engine single --threads 1 --quality medium --out /tmp/maitake-single
node scripts/benchmark.mjs --input /path/to/clip.webm --engine multi --threads 4 --quality medium --out /tmp/maitake-multi
```

Run the commands sequentially on an otherwise idle computer. For quick thread selection, use a short clip first with 2 and 4 threads. Then compare the full-length clip. For repeatability, run both variants several times, alternating their order, and report the individual results as well as the median. Avoid benchmarking simultaneous conversions.

The script obtains the released recipe from commit `d3f27ae7431b4530f44399b96cada75a45844d04` and verifies that the new one-thread recipe still matches it exactly. Both engines use the same input file, WORKERFS mounting, quality preset, H.264/AAC codec, resolution and frame-rate rules. Only threading is changed. The result records:

- Input SHA-256, size and stream metadata.
- OS, CPU, memory, Chrome version and browser capabilities.
- Engine load, input mount/probe, encoding, output probe/read and total duration separately.
- Exact FFmpeg arguments, output metadata, size and SHA-256.
- A complete native FFmpeg decode of the downloaded MP4, which must succeed.

Each output directory contains `result.json` and `output.mp4`. Output bytes need not be identical between thread counts; compare playback, timestamps, dimensions, frame rate and audio as well as speed and size. The saved timing excludes the native validation after download.

Keep benchmark media and outputs outside the repository. A suitable public source is [Big Buck Bunny on Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Big_Buck_Bunny_4K.webm), attributed to Blender Foundation under [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/). Use a lower-resolution WebM derivative rather than the 2.76 GB original. Record the exact download URL and SHA-256, and document any trimmed interval. A trim with stream copying retains the downloaded video/audio compression; it does not synthesize or repeat frames.

Results on macOS Chrome demonstrate that environment only. Measure the same input on Windows Chrome before claiming a Windows speedup. Browser-reported device memory is a coarse capability hint, not measured peak process memory.

`--sample-memory true` optionally records the largest observed sum of RSS across the benchmark's Chrome descendant processes at one-second intervals using `ps`. Run this separately from the speed comparison. Shared pages can be counted more than once, sub-second peaks can be missed, and this is not the amount of uniquely allocated physical memory. If `ps` is unavailable or blocked, the report marks memory sampling unavailable without failing the conversion.

See [the 2026-10-30 local comparison](performance-2026-10-30.md) for the tested source, settings, results and limitations.
