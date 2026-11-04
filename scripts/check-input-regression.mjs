import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { copyFile, mkdir, unlink, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = fileURLToPath(new URL('../', import.meta.url));
const baseURL = process.env.TEST_BASE_URL || 'http://127.0.0.1:4173/';
const evidence = path.resolve(process.env.EVIDENCE_DIR || path.join(root, 'evidence/input-regression'));
await mkdir(evidence, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH, headless: true });
const results = [];

async function openPage() {
  const context = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
  await context.addInitScript(() => {
    window.engineLoads = []; window.engineCommands = []; window.engineFault = null;
    window.inputFault = null; window.snapshotReads = 0;
    document.addEventListener('change', event => {
      if (event.target.id === 'file-input') window.selectedDiskFile = event.target.files[0];
    }, true);
    const nativeRead = Blob.prototype.arrayBuffer;
    Blob.prototype.arrayBuffer = function () {
      window.snapshotReads++;
      const fault = window.inputFault;
      if (fault && !fault.used) {
        fault.used = true;
        if (fault.name) return Promise.reject(new DOMException('Injected input read failure', fault.name));
        if (fault.hold) return new Promise((resolve, reject) => {
          window.releaseSnapshot = () => nativeRead.call(this).then(resolve, reject);
        });
      }
      return nativeRead.call(this);
    };
    const NativeWorker = window.Worker;
    window.Worker = class extends NativeWorker {
      terminated = false;
      postMessage(message, ...rest) {
        if (message?.type === 'LOAD') window.engineLoads.push(message.data.coreURL.includes('/core-mt/') ? 'multi' : 'single');
        if (message?.type === 'EXEC') window.engineCommands.push(message.data.args);
        const fault = window.engineFault;
        if (fault && !fault.used && message?.type === fault.type) {
          fault.used = true;
          queueMicrotask(() => {
            if (!this.terminated) this.dispatchEvent(new MessageEvent('message', {
              data: { id: message.id, type: 'ERROR', data: fault.message || 'Injected parallel engine failure' },
            }));
          });
          return;
        }
        return super.postMessage(message, ...rest);
      }
      terminate() { this.terminated = true; return super.terminate(); }
    };
  });
  const page = await context.newPage();
  page.setDefaultTimeout(60000);
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(String(error)));
  await page.goto(baseURL);
  await page.waitForFunction(() => !document.getElementById('choose').disabled);
  return { context, page, pageErrors };
}

async function ready(page) {
  await page.waitForFunction(() => !document.getElementById('convert').disabled || !document.getElementById('error').hidden);
  assert.equal(await page.locator('#error').isVisible(), false, await page.locator('#error-report').inputValue());
}

async function sample(page) {
  await page.locator('#sample').click();
  await ready(page);
}

async function convert(page, filename) {
  await page.locator('#convert').click();
  await page.waitForFunction(() => !document.getElementById('result-card').hidden || !document.getElementById('error').hidden);
  assert.equal(await page.locator('#error').isVisible(), false, await page.locator('#error-report').inputValue());
  const downloadPromise = page.waitForEvent('download');
  await page.locator('#download').click();
  const output = path.join(evidence, filename);
  await (await downloadPromise).saveAs(output);
  const probe = JSON.parse(execFileSync(process.env.FFPROBE || 'ffprobe', ['-v', 'error', '-count_frames', '-show_streams', '-show_format', '-of', 'json', output], { encoding: 'utf8' }));
  execFileSync(process.env.FFMPEG || 'ffmpeg', ['-v', 'error', '-i', output, '-f', 'null', '-'], { stdio: ['ignore', 'pipe', 'pipe'] });
  const video = probe.streams.find(stream => stream.codec_type === 'video');
  assert.equal(video.codec_name, 'h264');
  return { file: filename, duration: Number(probe.format.duration), frames: Number(video.nb_read_frames), dimensions: `${video.width}x${video.height}` };
}

async function close(fixture) {
  assert.deepEqual(fixture.pageErrors, []);
  await fixture.context.close();
}

try {
  for (const mutation of ['overwrite', 'delete-fallback']) {
    const fixture = await openPage();
    const { page } = fixture;
    assert.equal(await page.evaluate(() => crossOriginIsolated), true, 'Requires the local isolation service worker');
    const input = path.join(evidence, `${mutation}-input.webm`);
    await copyFile(path.join(root, 'dist/assets/sample.webm'), input);
    await page.locator('#file-input').setInputFiles(input);
    await ready(page);
    assert.ok(await page.evaluate(() => snapshotReads > 0), 'Input must be materialized before probing');
    if (mutation === 'overwrite') await writeFile(input, 'The original video was replaced after selection.');
    else {
      await unlink(input);
      await page.evaluate(() => { window.engineFault = { type: 'EXEC' }; });
    }
    const originalReadError = await page.evaluate(async () => {
      try { await selectedDiskFile.arrayBuffer(); return null; } catch (error) { return error.name; }
    });
    assert.ok(['NotFoundError', 'NotReadableError'].includes(originalReadError), `Disk-backed File should now be unreadable, got ${originalReadError}`);
    const output = await convert(page, `${mutation}.mp4`);
    assert.ok(output.duration > 4.8 && output.duration < 5.3);
    assert.deepEqual(await page.evaluate(() => engineLoads), mutation === 'overwrite' ? ['multi'] : ['multi', 'single']);
    results.push({ test: `snapshot-survives-${mutation}`, originalReadError, ...output });
    if (mutation === 'overwrite') {
      await page.screenshot({ path: path.join(evidence, 'snapshot-success.png'), fullPage: true });
      const repeated = await convert(page, 'overwrite-repeat.mp4');
      assert.ok(repeated.duration > 4.8 && repeated.duration < 5.3);
      assert.deepEqual(await page.evaluate(() => engineLoads), ['multi', 'multi'], 'Reinitializing the released engine must keep using the detached snapshot');
      results.push({ test: 'snapshot-survives-reconversion-after-engine-release', ...repeated });
    }
    await close(fixture);
  }

  for (const name of ['NotFoundError', 'NotReadableError']) {
    const fixture = await openPage();
    const { page } = fixture;
    await page.evaluate(name => { window.inputFault = { name }; }, name);
    await page.locator('#file-input').setInputFiles(path.join(root, 'dist/assets/sample.webm'));
    await page.locator('#error').waitFor({ state: 'visible' });
    assert.match(await page.locator('#error-message').textContent(), /選び直/);
    assert.match(await page.locator('#error-report').inputValue(), new RegExp(name));
    assert.equal(await page.locator('#convert').isDisabled(), true);
    assert.deepEqual(await page.evaluate(() => engineLoads), [], 'A source read failure cannot be fixed by changing engines');
    await sample(page);
    results.push({ test: `${name}-has-guidance-and-reselect-recovers`, ...await convert(page, `${name}-reselected.mp4`) });
    await close(fixture);
  }

  const cancelled = await openPage();
  await cancelled.page.evaluate(() => { window.inputFault = { hold: true }; });
  await cancelled.page.locator('#file-input').setInputFiles(path.join(root, 'dist/assets/sample.webm'));
  await cancelled.page.waitForFunction(() => typeof releaseSnapshot === 'function');
  await cancelled.page.locator('#cancel').click();
  assert.equal(await cancelled.page.locator('#convert').isDisabled(), true);
  await sample(cancelled.page);
  await cancelled.page.evaluate(async () => { await releaseSnapshot(); });
  await cancelled.page.waitForTimeout(100);
  assert.equal(await cancelled.page.locator('#file-name').textContent(), 'quiet-coast.webm');
  assert.equal(await cancelled.page.locator('#error').isVisible(), false);
  assert.deepEqual(await cancelled.page.evaluate(() => engineLoads), ['multi']);
  results.push({ test: 'cancelled-snapshot-cannot-replace-new-selection', ...await convert(cancelled.page, 'cancel-reselected.mp4') });
  await close(cancelled);

  const workerRead = await openPage();
  await sample(workerRead.page);
  await workerRead.page.evaluate(() => { window.engineFault = { type: 'EXEC', message: "NotFoundError: Failed to execute 'readAsArrayBuffer' on 'FileReaderSync': A requested file or directory could not be found" }; });
  await workerRead.page.locator('#convert').click();
  await workerRead.page.locator('#error').waitFor({ state: 'visible' });
  assert.match(await workerRead.page.locator('#error-message').textContent(), /選び直/);
  assert.deepEqual(await workerRead.page.evaluate(() => engineLoads), ['multi'], 'Do not retry source-read errors using the same unreadable input');
  results.push({ test: 'worker-read-error-has-guidance-without-engine-retry', passed: true });
  await workerRead.page.locator('#error').screenshot({ path: path.join(evidence, 'input-read-guidance.png') });
  await close(workerRead);

  if (process.env.VFR_INPUT) {
    const fixture = await openPage();
    await fixture.page.locator('#file-input').setInputFiles(process.env.VFR_INPUT);
    await ready(fixture.page);
    await fixture.page.locator('input[name="quality"][value="high"]').check();
    const output = await convert(fixture.page, 'variable-framerate-high.mp4');
    assert.ok(output.frames >= 29 && output.frames <= 31, `Expected roughly 30 original frames, got ${output.frames}`);
    assert.ok(output.duration > 2.7 && output.duration < 3.2);
    results.push({ test: 'unknown-framerate-webm-preserves-frames', ...output });
    await close(fixture);
  }

  const report = { baseURL, browser: browser.version(), platform: process.platform, results };
  await writeFile(path.join(evidence, 'results.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
} finally { await browser.close(); }
