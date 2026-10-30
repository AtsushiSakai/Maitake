import test from 'node:test';
import assert from 'node:assert/strict';
import { selectEngineConfig, coreURLs } from '../dist/engine-config.js';

const capable = { isolated: true, sharedArrayBuffer: true, hardwareConcurrency: 8, deviceMemory: 8 };

test('parallel conversion requires isolation, shared memory, and sufficient resources', () => {
  for (const overrides of [
    { isolated: false },
    { sharedArrayBuffer: false },
    { hardwareConcurrency: 1 },
    { hardwareConcurrency: undefined },
    { deviceMemory: 2 },
  ]) {
    assert.deepEqual(selectEngineConfig({ ...capable, ...overrides }), { mode: 'single', threads: 1 });
  }
  assert.deepEqual(selectEngineConfig(capable, true), { mode: 'single', threads: 1 });
});

test('worker counts reserve capacity and remain conservative on smaller or unknown-memory devices', () => {
  assert.deepEqual(selectEngineConfig(capable), { mode: 'multi', threads: 4 });
  assert.deepEqual(selectEngineConfig({ ...capable, hardwareConcurrency: 4 }), { mode: 'multi', threads: 3 });
  assert.deepEqual(selectEngineConfig({ ...capable, hardwareConcurrency: 2 }), { mode: 'multi', threads: 2 });
  for (const deviceMemory of [undefined, 4]) {
    assert.deepEqual(selectEngineConfig({ ...capable, deviceMemory }), { mode: 'multi', threads: 2 });
  }
  assert.deepEqual(selectEngineConfig({ ...capable, hardwareConcurrency: 64 }), { mode: 'multi', threads: 4 });
});

test('both engines use same-origin assets under the deployed project path', () => {
  const base = 'https://example.test/Maitake/app.js';
  assert.deepEqual(coreURLs({ mode: 'single', threads: 1 }, base), {
    coreURL: 'https://example.test/Maitake/vendor/core/ffmpeg-core.js',
    wasmURL: 'https://example.test/Maitake/vendor/core/ffmpeg-core.wasm',
  });
  assert.deepEqual(coreURLs({ mode: 'multi', threads: 4 }, base), {
    coreURL: 'https://example.test/Maitake/vendor/core-mt/ffmpeg-core.js',
    wasmURL: 'https://example.test/Maitake/vendor/core-mt/ffmpeg-core.wasm',
    workerURL: 'https://example.test/Maitake/vendor/core-mt/ffmpeg-core.worker.js',
  });
});
