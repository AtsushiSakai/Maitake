const CHUNK_BYTES = 8 * 1024 * 1024;

// A File constructed from another File still refers to the original disk data.
// Read each chunk first, then keep browser-owned bytes outside the WASM heap.
// Reuse this snapshot for preview, conversion, and engine fallback/retry.
export async function snapshotFile(file, assertCurrent = () => {}) {
  const chunks = [];
  assertCurrent();
  for (let offset = 0; offset < file.size; offset += CHUNK_BYTES) {
    const end = Math.min(offset + CHUNK_BYTES, file.size);
    const bytes = await file.slice(offset, end).arrayBuffer();
    assertCurrent();
    if (bytes.byteLength !== end - offset) {
      throw new DOMException('The selected file could not be read completely.', 'NotReadableError');
    }
    // Construct each Blob separately to bound temporary ArrayBuffer memory.
    chunks.push(new Blob([bytes]));
  }
  return new File(chunks, file.name, { type: file.type, lastModified: file.lastModified });
}

export function isInputReadError(error) {
  const seen = new Set();
  for (let current = error; current != null && !seen.has(current); current = current?.cause) {
    seen.add(current);
    // ffmpeg.wasm serializes worker exceptions as strings.
    if (/NotFoundError|NotReadableError|FileReaderSync|requested file or directory could not be found/i.test(`${current?.name || ''}: ${current?.message || current}`)) return true;
  }
  return false;
}
