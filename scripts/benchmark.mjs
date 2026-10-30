import http from 'node:http';
import { createReadStream } from 'node:fs';
import { mkdir, stat, writeFile, readFile } from 'node:fs/promises';
import { execFile, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Run with an isolated browser profile; no user browsing state is accessed.
// Example: PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs CHROME_PATH=/path/to/chrome 
// node scripts/benchmark.mjs --input /path/to/clip.webm --engine multi --threads 4 --out /tmp/bench-mt4
const options = {};
for (let i = 2; i < process.argv.length; i += 2) {
  if (!process.argv[i]?.startsWith('--') || !process.argv[i + 1]) throw new Error('Expected --key value arguments');
  options[process.argv[i].slice(2)] = process.argv[i + 1];
}
if (!options.input) throw new Error('--input is required');
const input = path.resolve(options.input);
const engine = options.engine || 'single';
const threads = Number(options.threads || (engine === 'single' ? 1 : 4));
const quality = options.quality || 'medium';
if (!['single', 'multi'].includes(engine) || ![1, 2, 3, 4].includes(threads) || (engine === 'single' && threads !== 1)) throw new Error('Invalid engine or thread count');
if (!['high', 'medium', 'light'].includes(quality)) throw new Error('Invalid quality');
const root = fileURLToPath(new URL('../', import.meta.url));
const dist = path.join(root, 'dist');
const outputDir = path.resolve(options.out || `/tmp/maitake-benchmark-${engine}-${threads}-${Date.now()}`);
await mkdir(outputDir, { recursive: true });
const baselineRevision = 'd3f27ae7431b4530f44399b96cada75a45844d04';
const baselineRecipes = execFileSync('git', ['show', `${baselineRevision}:dist/recipes.js`], { cwd: root, encoding: 'utf8' });
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.wasm': 'application/wasm', '.json': 'application/json' };
const server = http.createServer(async (req, res) => {
  const headers = { 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'require-corp', 'Cache-Control': 'no-store' };
  try {
    if (req.method !== 'GET') { res.writeHead(405, headers).end(); return; }
    const name = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    if (name === '/') { res.writeHead(200, { ...headers, 'Content-Type': 'text/html' }).end('<!doctype html><meta charset="utf-8"><title>Maitake performance comparison</title><input id="input" type="file"><a id="download">Save</a>'); return; }
    if (name === '/baseline-recipes.js') { res.writeHead(200, { ...headers, 'Content-Type': 'text/javascript' }).end(baselineRecipes); return; }
    const file = path.resolve(dist, `.${name}`);
    if (!file.startsWith(`${dist}${path.sep}`)) { res.writeHead(403, headers).end(); return; }
    const info = await stat(file);
    if (!info.isFile()) { res.writeHead(404, headers).end(); return; }
    res.writeHead(200, { ...headers, 'Content-Type': mime[path.extname(file)] || 'application/octet-stream', 'Content-Length': info.size });
    createReadStream(file).pipe(res);
  } catch { res.writeHead(404, headers).end('Not found'); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const playwrightLocation = process.env.PLAYWRIGHT_MODULE;
const { chromium } = await import(playwrightLocation ? pathToFileURL(playwrightLocation).href : 'playwright');
let browser;
const resultPath = path.join(outputDir, 'result.json');
const result = { timestamp: new Date().toISOString(), engine, threads, quality, baselineRevision, input, outputDir,
  host: { platform: os.platform(), release: os.release(), arch: os.arch(), cpu: os.cpus()[0]?.model, logicalCpus: os.cpus().length, totalMemoryBytes: os.totalmem() } };
function sampleBrowserMemory() {
  const memory = { method: 'Sum of RSS of browser descendant processes, sampled each second; shared pages may be counted more than once.', samples: 0, peakRssBytes: 0 };
  let pending = Promise.resolve(), sampling = false;
  const sample = () => {
    if (sampling || memory.error) return;
    sampling = true;
    pending = new Promise(resolve => {
      const child = execFile('ps', ['-axo', 'pid=,ppid=,rss='], { timeout: 2000 }, (error, stdout) => {
        if (error) memory.error = String(error.message);
        else {
          const rows = stdout.trim().split('\n').map(line => line.trim().split(/\s+/).map(Number));
          const descendants = new Set([process.pid]);
          let added = true;
          while (added) {
            added = false;
            for (const [pid, parent] of rows) if (pid !== child.pid && descendants.has(parent) && !descendants.has(pid)) { descendants.add(pid); added = true; }
          }
          const bytes = rows.reduce((sum, [pid, , rss]) => sum + (pid !== process.pid && descendants.has(pid) ? rss * 1024 : 0), 0);
          if (bytes > 0) { memory.samples++; memory.peakRssBytes = Math.max(memory.peakRssBytes, bytes); }
        }
        sampling = false; resolve();
      });
    });
  };
  const timer = setInterval(sample, 1000);
  sample();
  return async () => { clearInterval(timer); await pending; memory.available = memory.samples > 0; result.memory = memory; };
}
let stopMemory;
try {
  result.inputBytes = (await stat(input)).size;
  result.inputSha256 = createHash('sha256').update(await readFile(input)).digest('hex');
  browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: options.headless !== 'false', args: ['--disable-background-timer-throttling', '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding'] });
  result.browserVersion = browser.version();
  if (options['sample-memory'] === 'true') stopMemory = sampleBrowserMemory();
  const context = await browser.newContext({ acceptDownloads: true });
  const page = await context.newPage();
  page.on('console', message => console.log(`[browser] ${message.text()}`));
  page.on('pageerror', error => console.error(`[browser error] ${error.message}`));
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  await page.locator('#input').setInputFiles(input);
  console.log(`Starting ${engine} ${threads} thread(s), ${quality}, ${result.inputBytes} input bytes`);
  Object.assign(result, await page.evaluate(async ({ engine, threads, quality }) => {
    const { FFmpeg } = await import('/vendor/ffmpeg/index.js');
    const current = await import('/recipes.js');
    const baseline = await import('/baseline-recipes.js');
    if (!crossOriginIsolated) throw new Error('Benchmark context is not cross-origin isolated');
    const ff = new FFmpeg();
    const logs = [];
    let lastProgress = 0;
    ff.on('log', ({ message }) => { logs.push(message); if (logs.length > 60) logs.shift(); });
    ff.on('progress', ({ time }) => { if (performance.now() - lastProgress > 15000) { console.log(`Encoded media time: ${(time / 1e6).toFixed(1)} s`); lastProgress = performance.now(); } });
    const started = performance.now();
    const folder = engine === 'single' ? 'core' : 'core-mt';
    await ff.load({ coreURL: `${location.origin}/vendor/${folder}/ffmpeg-core.js`, wasmURL: `${location.origin}/vendor/${folder}/ffmpeg-core.wasm`, ...(engine === 'multi' ? { workerURL: `${location.origin}/vendor/${folder}/ffmpeg-core.worker.js` } : {}) });
    const loaded = performance.now();
    const selected = document.querySelector('#input').files[0];
    const localFile = new File([selected], 'source.webm', { type: selected.type });
    await ff.createDir('/input');
    if (!(await ff.mount('WORKERFS', { files: [localFile] }, '/input'))) throw new Error('WORKERFS mount failed');
    const probe = async (name, destination) => {
      const code = await ff.ffprobe(['-v', 'error', '-show_streams', '-show_format', '-of', 'json', name, '-o', destination]);
      if (code !== 0 && code !== -1) throw new Error(`ffprobe failed: ${code}`);
      const data = JSON.parse(await ff.readFile(destination, 'utf8'));
      await ff.deleteFile(destination);
      return data;
    };
    const inputProbe = await probe('/input/source.webm', 'input.json');
    const info = current.summarizeProbe(inputProbe);
    const argsInput = { input: '/input/source.webm', format: 'mp4', quality, info };
    const oldArgs = baseline.buildArgs(argsInput);
    if (JSON.stringify(oldArgs) !== JSON.stringify(current.buildArgs({ ...argsInput, threads: 1 }))) throw new Error('Current single-thread recipe differs from released baseline');
    const args = engine === 'single' ? oldArgs : current.buildArgs({ ...argsInput, threads });
    const prepared = performance.now();
    console.log(`Core loaded in ${((loaded - started) / 1000).toFixed(2)} s; input ${info.width}x${info.height}, ${info.fps} fps, ${info.duration} s`);
    const code = await ff.exec(args);
    const converted = performance.now();
    if (code !== 0) throw new Error(`Encoding failed (${code}): ${logs.join('\n')}`);
    const outputProbe = await probe('output.mp4', 'output.json');
    const data = await ff.readFile('output.mp4');
    const blob = new Blob([data], { type: 'video/mp4' });
    const link = document.querySelector('#download');
    link.href = URL.createObjectURL(blob); link.download = 'output.mp4';
    const finished = performance.now();
    ff.terminate();
    return { browser: { userAgent: navigator.userAgent, hardwareConcurrency: navigator.hardwareConcurrency, deviceMemoryGiB: navigator.deviceMemory, crossOriginIsolated }, inputProbe, outputProbe, args, outputBytes: data.length,
      timingsSeconds: { engineLoad: (loaded - started) / 1000, mountAndProbe: (prepared - loaded) / 1000, encode: (converted - prepared) / 1000, outputProbeAndRead: (finished - converted) / 1000, total: (finished - started) / 1000 }, logs };
  }, { engine, threads, quality }));
  if (stopMemory) { await stopMemory(); stopMemory = null; }
  const downloadPromise = page.waitForEvent('download');
  await page.locator('#download').click();
  const download = await downloadPromise;
  result.outputPath = path.join(outputDir, 'output.mp4');
  await download.saveAs(result.outputPath);
  result.outputSha256 = createHash('sha256').update(await readFile(result.outputPath)).digest('hex');
  result.nativeProbe = JSON.parse(execFileSync(process.env.FFPROBE || 'ffprobe', ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', result.outputPath], { encoding: 'utf8' }));
  execFileSync(process.env.FFMPEG || 'ffmpeg', ['-v', 'error', '-xerror', '-i', result.outputPath, '-f', 'null', '-'], { stdio: ['ignore', 'pipe', 'pipe'] });
  result.fullDecodeVerified = true;
  result.success = true;
  console.log(JSON.stringify({ resultPath, timingsSeconds: result.timingsSeconds, outputBytes: result.outputBytes, fullDecodeVerified: true }, null, 2));
} catch (error) {
  result.success = false; result.error = String(error.stack || error); process.exitCode = 1;
  console.error(result.error);
} finally {
  if (stopMemory) await stopMemory();
  await writeFile(resultPath, `${JSON.stringify(result, null, 2)}\n`);
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}
