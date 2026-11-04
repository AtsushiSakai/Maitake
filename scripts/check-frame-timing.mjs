// Run with Node after npm run build. No native FFmpeg or browser is required.
// Uses the same FFmpeg 5.1 WASM as the application: newer native FFmpeg's
// automatic MP4 sync behavior does not reproduce this regression.
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { buildArgs, summarizeProbe } from '../dist/recipes.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const evidence = path.resolve(process.env.EVIDENCE_DIR || path.join(root, 'evidence/frame-timing'));
await mkdir(evidence, { recursive: true });
// Synthetic 30-frame, 160x90 teal VP8 clip. Generated with native FFmpeg:
// -f lavfi -i color=c=teal:size=160x90:rate=30:duration=1
// -vf 'settb=1/1000,setpts=N*101+mod(N*N\,61)' -fps_mode passthrough
// -enc_time_base 1/1000 -c:v libvpx -deadline realtime -cpu-used 5 -an fixture.webm
// Replace EBML DefaultDuration (0x23e383) with an equal-size Void element.
// The missing duration and irregular timestamps reproduce browser recordings:
// avg_frame_rate=0/0, r_frame_rate=1000/1. No user video is included.
const fixture = Buffer.from('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', 'base64');
await writeFile(path.join(evidence, 'unknown-rate.webm'), fixture);
// The single-thread browser build only needs this Worker location shim when
// instantiated with wasmBinary and exercised entirely through MEMFS in Node.
globalThis.self = { location: { href: new URL('../dist/vendor/core/ffmpeg-core.js', import.meta.url).href } };
const { default: createFFmpegCore } = await import('../dist/vendor/core/ffmpeg-core.js');
const core = await createFFmpegCore({ wasmBinary: await readFile(path.join(root, 'dist/vendor/core/ffmpeg-core.wasm')) });
let logs = [];
core.setLogger(({ message }) => logs.push(message));
function run(args, probe = false) {
  core.reset();
  logs = [];
  const result = probe ? core.ffprobe(...args) : core.exec(...args);
  // This bundled ffprobe leaves Module.ret at -1 on success; validate its JSON
  // output below, as the application does. FFmpeg sets its exit status normally.
  if (!probe) assert.equal(result, 0, logs.join('\n'));
  return [...logs];
}
function inspect(name, frames = false) {
  const args = ['-v', 'error', '-count_frames', '-show_streams', '-show_format'];
  if (frames) args.push('-show_frames', '-show_entries', 'frame=best_effort_timestamp_time:stream:format');
  run([...args, '-of', 'json', name, '-o', 'probe.json'], true);
  const result = JSON.parse(core.FS.readFile('probe.json', { encoding: 'utf8' }));
  core.FS.unlink('probe.json');
  return result;
}
const video = probe => probe.streams.find(stream => stream.codec_type === 'video');
const count = probe => Number(video(probe).nb_read_frames);
const duration = probe => Number(probe.format.duration);
const timestamps = probe => probe.frames.map(frame => Number(frame.best_effort_timestamp_time));
core.FS.writeFile('unknown.webm', fixture);
const source = inspect('unknown.webm', true);
assert.equal(video(source).avg_frame_rate, '0/0');
assert.equal(video(source).r_frame_rate, '1000/1');
assert.equal(count(source), 30);
const info = summarizeProbe(source);
assert.equal(info.fps, 0);
const results = [];
for (const name of ['before-mp4', 'high-mp4', 'high-mov', 'high-avi', 'high-webm', 'medium-mp4', 'light-mp4']) {
  const [quality, format] = name.split('-');
  const args = buildArgs({ input: 'unknown.webm', format, quality: quality === 'before' ? 'high' : quality, info });
  if (quality === 'before') args.splice(args.indexOf('-fps_mode'), 2);
  const encodeLogs = run(args);
  const output = `output.${format}`;
  const probe = inspect(output, quality === 'high');
  const frames = count(probe);
  if (quality === 'before') assert.ok(frames > count(source) * 20, 'Baseline must reproduce the frame explosion');
  else if (quality === 'high') {
    assert.equal(frames, count(source), name);
    const actual = timestamps(probe);
    const expected = timestamps(source);
    for (let i = 0; i < actual.length; i++) assert.ok(Math.abs(actual[i] - expected[i]) <= 0.0011, `${name}: frame ${i} timing changed`);
    assert.ok(!encodeLogs.some(line => /dup=[1-9]/.test(line)), `${name}: unexpected duplicated frames`);
  } else {
    // Existing medium/light behavior uses an explicit bounded 30fps filter
    // for unknown rates. High preserves the original variable timestamps.
    assert.ok(frames <= Math.ceil(duration(source) * 30) + 1, name);
  }
  assert.ok(Math.abs(duration(probe) - duration(source)) < 0.15, `${name}: duration changed`);
  run(['-hide_banner', '-v', 'error', '-xerror', '-err_detect', 'explode', '-i', output, '-f', 'null', '-']);
  await writeFile(path.join(evidence, `${name}.${format}`), core.FS.readFile(output));
  results.push({ name, frames, duration: duration(probe), avgFrameRate: video(probe).avg_frame_rate, nominalFrameRate: video(probe).r_frame_rate, h264Level: video(probe).level, args });
  core.FS.unlink(output);
}
// Ordinary fixed-rate inputs also retain their frames in every output format.
core.FS.writeFile('sample.webm', await readFile(path.join(root, 'dist/assets/sample.webm')));
const sample = inspect('sample.webm');
for (const format of ['mp4', 'mov', 'avi', 'webm']) {
  const args = buildArgs({ input: 'sample.webm', format, quality: 'high', info: summarizeProbe(sample) });
  run(args);
  const probe = inspect(`output.${format}`);
  assert.equal(count(probe), count(sample), `sample-${format}`);
  run(['-hide_banner', '-v', 'error', '-xerror', '-err_detect', 'explode', '-i', `output.${format}`, '-f', 'null', '-']);
  results.push({ name: `sample-${format}`, frames: count(probe), duration: duration(probe) });
  core.FS.unlink(`output.${format}`);
}
const report = {
  input: { frames: count(source), duration: duration(source), avgFrameRate: video(source).avg_frame_rate, nominalFrameRate: video(source).r_frame_rate },
  results,
  limitation: 'The nominal rate can still select an unnecessarily high H.264 level. Actual frames and timestamps are preserved; this check does not verify Windows or iPhone player compatibility.',
};
await writeFile(path.join(evidence, 'results.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
