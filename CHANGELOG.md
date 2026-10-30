# Changelog

## Unreleased

- Use a multi-thread FFmpeg engine with bounded codec/filter concurrency on supported browsers, preserving output formats and quality settings.
- Fall back to the single-thread engine when parallel initialization or conversion fails.
- Enable isolation within the application's Service Worker scope on static hosts, before file selection.
- Add reproducible local Chrome performance and conversion checks.

## 0.1.0

- Initial Maitake release: video conversion entirely inside the browser.
- MP4, MOV, AVI, and WebM output, with three quality presets.
- Local file preview, progress, cancellation, and downloadable results.
- Prominent notice that selected video, audio, and filenames are not uploaded.
- Japanese interface, up to 300 MB input, and a built-in synthetic sample.
- Same-origin conversion assets and downloadable third-party source/license materials.

See [validation and limitations](docs/validation.md).
