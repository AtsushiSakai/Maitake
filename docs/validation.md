# Maitake 0.1.0 validation

## Unreleased multithread validation — 2026-10-30

The local Chrome performance and regression results are recorded in [the comparison report](performance-2026-10-30.md). The previous release checks below are historical. No new deployment or Windows measurement is implied by the local results.

## Confirmed before publication

- Seven automated recipe tests pass: file-size boundaries, MP4/MOV codecs, AVI/WebM codecs, quality presets, frame-rate handling, metadata parsing, and filenames.
- Desktop Chrome converted a synthetic 960 × 540 / approximately 5-second WebM sample into MP4, MOV, AVI, and WebM. The app probes generated output before showing completion. MP4 and WebM previews decoded in Chrome.
- A synthetic uncompressed AVI of 298,635,314 bytes (1280 × 720, 20 fps, approximately 5.4 seconds, no audio) converted to MP4 at light quality. Cancellation followed by retry also worked. This checks one input near the size limit, not all 300 MB videos or long/4K recordings.
- Native FFmpeg checks of the MP4 recipes on a portrait 1080 × 1920 / 60 fps clip produced 1080 × 1920 / 60 fps at highest, 1080 × 1920 / 30 fps at medium, and 720 × 1280 / 30 fps at light. These are native recipe checks, separate from browser execution.
- Local-only input handling and same-origin engine loading were reviewed in source. There is no upload API, analytics SDK, external font, or CDN dependency in the app.

## Limitations

- Playback in the standard players on Windows, Ubuntu, macOS, and iPhone has not been verified on devices. Compatibility depends on OS/player codecs.
- SDR only; one video stream and the first optional audio stream. No subtitles, additional audio, chapters, or original metadata. Highest quality still re-encodes.
- Input limit: 300,000,000 bytes. Output limit: 600,000,000 bytes. Encoding time and memory depend on the computer and media.
- Browser memory and codec failures remain possible. Conversion can be cancelled and retried.
- A complete captured network audit has not been performed; the privacy review above describes source inspection.

Public-site verification is recorded in the release notes once deployment completes.
