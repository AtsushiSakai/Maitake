import test from 'node:test';
import assert from 'node:assert/strict';
import { MAX_INPUT_BYTES, validateFile, buildArgs, summarizeProbe, frameRate, outputName, extension } from '../dist/recipes.js';
const info = { videoIndex: 0, fps: 60 };
const args = (format, quality = 'medium', meta = info) => buildArgs({ input: '/input/source.webm', format, quality, info: meta });
const option = (a, name) => a[a.indexOf(name) + 1];

test('300MB input boundary and empty files are enforced', () => {
  assert.doesNotThrow(() => validateFile({ size: MAX_INPUT_BYTES }));
  assert.throws(() => validateFile({ size: MAX_INPUT_BYTES + 1 }), /300MB/);
  assert.throws(() => validateFile({ size: 0 }), /空/);
});
test('MP4 and MOV use interoperable 8-bit 4:2:0 H.264 / AAC', () => {
  for (const format of ['mp4', 'mov']) {
    const a = args(format);
    assert.equal(option(a, '-c:v'), 'libx264');
    assert.equal(option(a, '-c:a'), 'aac');
    assert.equal(option(a, '-pix_fmt'), 'yuv420p');
    assert.equal(a.at(-1), `output.${format}`);
    assert.equal(option(a, '-movflags'), '+faststart');
  }
});
test('AVI and WebM use distinct container-compatible encoders', () => {
  assert.equal(option(args('avi'), '-c:v'), 'mjpeg');
  assert.equal(option(args('avi'), '-c:a'), 'pcm_s16le');
  assert.equal(option(args('avi'), '-huffman'), 'default');
  assert.equal(option(args('webm'), '-c:v'), 'libvpx');
  assert.equal(option(args('webm'), '-c:a'), 'libvorbis');
});
test('highest preserves frame rate, capped modes never raise low frame rates', () => {
  assert.doesNotMatch(option(args('mp4', 'high'), '-vf'), /fps=|1920|1280/);
  assert.match(option(args('mp4', 'medium'), '-vf'), /fps=30/);
  assert.doesNotMatch(option(args('mp4', 'light', { ...info, fps: 24 }), '-vf'), /fps=/);
  assert.match(option(args('mp4', 'light'), '-vf'), /1280.*720/);
});
test('unknown-rate browser recordings keep timestamps without uncontrolled CFR duplication', () => {
  const recording = summarizeProbe({ streams: [
    { index: 0, codec_type: 'video', width: 1910, height: 1076, avg_frame_rate: '0/0', r_frame_rate: '1000/1' },
  ] });
  // r_frame_rate is not a trustworthy fallback for variable-rate recordings.
  assert.equal(recording.fps, 0);
  for (const format of ['mp4', 'mov', 'avi', 'webm']) {
    const high = args(format, 'high', recording);
    assert.equal(option(high, '-fps_mode'), 'vfr');
    assert.doesNotMatch(option(high, '-vf'), /fps=/);
    assert.ok(!high.includes('-r'));
    for (const quality of ['medium', 'light']) {
      const capped = args(format, quality, recording);
      assert.equal(option(capped, '-fps_mode'), 'vfr');
      assert.match(option(capped, '-vf'), /fps=30/);
    }
  }
});
test('quality levels change actual compression, and optional audio is mapped', () => {
  assert.deepEqual(['high', 'medium', 'light'].map(q => option(args('mp4', q), '-crf')), ['18', '23', '28']);
  assert.ok(args('mp4').includes('0:a:0?'));
  assert.equal(option(args('mp4'), '-ac'), '2');
  assert.throws(() => args('unknown'), /正しく/);
});
test('probe excludes cover art, accounts for rotation, flags HDR and no audio', () => {
  const parsed = summarizeProbe({ format: { duration: '12.5' }, streams: [
    { index: 0, codec_type: 'video', disposition: { attached_pic: 1 }, width: 32, height: 32 },
    { index: 1, codec_type: 'video', codec_name: 'hevc', width: 1920, height: 1080, avg_frame_rate: '30000/1001', side_data_list: [{ rotation: -90 }], color_transfer: 'smpte2084' },
  ] });
  assert.equal(parsed.videoIndex, 1);
  assert.equal(parsed.width, 1080); assert.equal(parsed.height, 1920);
  assert.equal(parsed.duration, 12.5); assert.equal(parsed.hdr, true);
  assert.equal(parsed.audio, undefined);
  assert.throws(() => summarizeProbe({ streams: [{ codec_type: 'audio' }] }), /映像/);
});
test('filename extraction is case-insensitive and save names are portable', () => {
  assert.equal(extension('旅の映像.MOV'), 'mov');
  assert.equal(extension('unknown'), 'bin');
  assert.equal(outputName('clip:one.MOV', 'mp4', 'high'), 'clip_one_high.mp4');
  assert.equal(frameRate('0/0'), 0);
});

test('parallel recipes preserve all format and quality settings while bounding worker counts', () => {
  const withoutThreads = values => values.filter((value, index, list) =>
    !['-threads', '-filter_threads'].includes(value) && !['-threads', '-filter_threads'].includes(list[index - 1]));
  for (const format of ['mp4', 'mov', 'avi', 'webm']) {
    for (const quality of ['high', 'medium', 'light']) {
      const single = args(format, quality);
      for (const threads of [2, 3, 4]) {
        const parallel = buildArgs({ input: '/input/source.webm', format, quality, info, threads });
        assert.deepEqual(withoutThreads(parallel), withoutThreads(single));
        assert.deepEqual(parallel.flatMap((value, index) => value === '-threads' ? [parallel[index + 1]] : []), [String(threads), String(threads)]);
        assert.equal(option(parallel, '-filter_threads'), String(threads));
      }
      assert.deepEqual(buildArgs({ input: '/input/source.webm', format, quality, info, threads: 1 }), single);
      assert.ok(!single.includes('-filter_threads'));
    }
  }
  for (const threads of [0, -1, 1.5, 5, NaN, Infinity, '2']) {
    assert.throws(() => buildArgs({ input: '/input/source.webm', format: 'mp4', quality: 'medium', info, threads }));
  }
});
