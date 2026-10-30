// Bound active codec/filter threads. Upstream core-mt still reserves a 1 GiB
// shared heap and precreates 32 pthread workers, regardless of these limits.
export function selectEngineConfig({ isolated, sharedArrayBuffer, hardwareConcurrency, deviceMemory } = {}, forceSingle = false) {
  const cores = Math.floor(Number(hardwareConcurrency) || 1);
  const memory = Number(deviceMemory) || 0;
  if (forceSingle || !isolated || !sharedArrayBuffer || cores < 2 || (memory > 0 && memory <= 2)) {
    return { mode: 'single', threads: 1 };
  }
  const limit = memory > 4 ? 4 : 2;
  return { mode: 'multi', threads: Math.min(limit, Math.max(2, cores - 1)) };
}

export function coreURLs(config, baseURL) {
  const folder = config.mode === 'multi' ? 'core-mt' : 'core';
  const url = name => new URL(`./vendor/${folder}/${name}`, baseURL).href;
  return {
    coreURL: url('ffmpeg-core.js'),
    wasmURL: url('ffmpeg-core.wasm'),
    ...(config.mode === 'multi' ? { workerURL: url('ffmpeg-core.worker.js') } : {}),
  };
}
