import test from 'node:test';
import assert from 'node:assert/strict';
import { snapshotFile, isInputReadError } from '../dist/input-file.js';

test('snapshot reads all chunks into independent bytes and preserves file metadata', async () => {
  const size = 8 * 1024 * 1024 + 7;
  const backing = new Uint8Array(size).fill(17);
  backing[size - 1] = 42;
  const ranges = [];
  const file = { size, name: '録画.webm', type: 'video/webm', lastModified: 123,
    slice(start, end) {
      ranges.push([start, end]);
      return { arrayBuffer: async () => backing.slice(start, end).buffer };
    } };
  const copy = await snapshotFile(file);
  backing.fill(0);
  assert.equal(copy.name, file.name);
  assert.equal(copy.type, file.type);
  assert.equal(copy.lastModified, file.lastModified);
  assert.equal(copy.size, size);
  assert.deepEqual(ranges, [[0, 8 * 1024 * 1024], [8 * 1024 * 1024, size]]);
  const bytes = new Uint8Array(await copy.arrayBuffer());
  assert.equal(bytes[0], 17);
  assert.equal(bytes[8 * 1024 * 1024], 17);
  assert.equal(bytes[size - 1], 42);
});

test('unavailable and short reads fail without returning a partial snapshot', async () => {
  const error = new DOMException('File gone', 'NotFoundError');
  await assert.rejects(snapshotFile({ size: 1, slice: () => ({ arrayBuffer: async () => { throw error; } }) }), value => value === error);
  await assert.rejects(snapshotFile({ size: 2, slice: () => ({ arrayBuffer: async () => new ArrayBuffer(1) }) }), { name: 'NotReadableError' });
});

test('cancel after a pending read does not read another chunk or return a snapshot', async () => {
  let cancelled = false, reads = 0;
  const file = { size: 9 * 1024 * 1024, slice: () => ({ arrayBuffer: async () => {
    reads++; cancelled = true; return new ArrayBuffer(8 * 1024 * 1024);
  } }) };
  await assert.rejects(snapshotFile(file, () => { if (cancelled) throw new DOMException('Cancelled', 'AbortError'); }), { name: 'AbortError' });
  assert.equal(reads, 1);
});

test('file errors survive worker serialization and wrapped causes', () => {
  for (const error of [new DOMException('missing', 'NotFoundError'), 'NotReadableError: changed',
    "NotFoundError: Failed to execute 'readAsArrayBuffer' on 'FileReaderSync'",
    new Error('Probe failed', { cause: 'NotFoundError: gone' })]) assert.equal(isInputReadError(error), true);
  for (const error of [new Error('out of memory'), 'Aborted()', 'NetworkError: Failed to fetch', null]) assert.equal(isInputReadError(error), false);
  const cycle = new Error('cycle'); cycle.cause = cycle;
  assert.equal(isInputReadError(cycle), false);
});
