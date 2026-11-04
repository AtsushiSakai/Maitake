import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = fileURLToPath(new URL('../', import.meta.url));
const baseURL = process.env.TEST_BASE_URL || 'http://127.0.0.1:4173/';
const evidence = path.resolve(process.env.EVIDENCE_DIR || path.join(root, 'evidence/errors'));
await mkdir(evidence, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH, headless: true });
const results = [];
let deadline;

async function openPage() {
  const context = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
  await context.addInitScript(() => {
    window.engineLoads = []; window.engineCommands = []; window.engineFault = null;
    const NativeWorker = window.Worker;
    window.Worker = class extends NativeWorker {
      terminated = false;
      mode = 'unknown';
      postMessage(message, ...rest) {
        if (message?.type === 'LOAD') {
          this.mode = message.data.coreURL.includes('/core-mt/') ? 'multi' : 'single';
          window.engineLoads.push(this.mode);
        }
        if (message?.type === 'EXEC') window.engineCommands.push(message.data.args);
        const fault = window.engineFault;
        if (fault && message?.type === fault.type && (!fault.mode || fault.mode === this.mode)) {
          setTimeout(() => {
            if (this.terminated) return;
            for (let i = 0; i < 100; i++) {
              this.dispatchEvent(new MessageEvent('message', { data: { type: 'LOG', data: { type: 'stderr', message: `Diagnostic filler ${this.mode} ${i}` } } }));
            }
            this.dispatchEvent(new MessageEvent('message', { data: { type: 'LOG', data: { type: 'stderr', message: `Decoder diagnostic ${this.mode}: unsupported test packet` } } }));
            const response = fault.exitCode === undefined
              ? { type: 'ERROR', data: `Injected ${this.mode} ${message.type} failure` }
              : { type: message.type, data: fault.exitCode };
            this.dispatchEvent(new MessageEvent('message', { data: { id: message.id, ...response } }));
          }, fault.delay || 0);
          return;
        }
        return super.postMessage(message, ...rest);
      }
      terminate() { this.terminated = true; return super.terminate(); }
    };
  });
  const page = await context.newPage();
  page.setDefaultTimeout(30000);
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(String(error)));
  await page.goto(baseURL);
  await page.waitForFunction(() => !document.getElementById('choose').disabled);
  return { context, page, pageErrors };
}

async function sample(page) {
  await page.locator('#sample').click();
  await page.waitForFunction(() => !document.getElementById('convert').disabled || !document.getElementById('error').hidden);
  assert.equal(await page.locator('#error').isVisible(), false, await page.locator('#error-message').textContent());
}

async function visibleReport(page) {
  await page.locator('#error').waitFor({ state: 'visible' });
  assert.equal(await page.locator('#error-details').getAttribute('open') !== null, true);
  assert.equal(await page.locator('#error-report').isVisible(), true);
  const report = await page.locator('#error-report').inputValue();
  assert.ok(report.length > 100, 'Error details must contain useful diagnostics');
  return report;
}

async function runChecks() {
  const corrupt = await openPage();
  await corrupt.page.locator('#file-input').setInputFiles({ name: 'broken.webm', mimeType: 'video/webm', buffer: Buffer.from('This is not a WebM video.') });
  const probeReport = await visibleReport(corrupt.page);
  assert.match(probeReport, /EBML|Invalid data|invalid data|End of file|error reading header/);
  assert.match(probeReport, /ffprobe/);
  assert.match(probeReport, /exitCode: -?[1-9]\d*/, 'Real failing ffprobe must preserve its return code');
  assert.match(probeReport, /webm/i);
  assert.equal(await corrupt.page.locator('#convert').isDisabled(), true);
  await writeFile(path.join(evidence, 'corrupt-webm.txt'), probeReport);
  await corrupt.page.locator('#error').screenshot({ path: path.join(evidence, 'error-panel.png') });
  results.push({ test: 'corrupt-webm-shows-real-ffprobe-error', passed: true });
  assert.deepEqual(corrupt.pageErrors, []);
  await corrupt.context.close();

  const failure = await openPage();
  const env = await failure.page.evaluate(() => ({ isolated: crossOriginIsolated, cores: navigator.hardwareConcurrency, memory: navigator.deviceMemory }));
  assert.equal(env.isolated, true, 'This check requires the local isolation service worker');
  await sample(failure.page);
  await failure.page.evaluate(() => { window.engineFault = { type: 'EXEC' }; });
  await failure.page.locator('#convert').click();
  const report = await visibleReport(failure.page);
  assert.deepEqual(await failure.page.evaluate(() => engineLoads), ['multi', 'single']);
  for (const mode of ['multi', 'single']) {
    assert.ok(report.includes(`Injected ${mode} EXEC failure`), `Original ${mode} failure missing`);
    assert.ok(report.includes(`Decoder diagnostic ${mode}: unsupported test packet`), `${mode} FFmpeg log missing`);
  }
  assert.match(report, /ffmpeg/);
  assert.match(report, /output\.mp4/);
  assert.equal(report.includes('Diagnostic filler multi 0\n'), false, 'Old log lines should be bounded');
  assert.equal(await failure.page.locator('#result-card').isVisible(), false);
  assert.equal(await failure.page.locator('#convert').isDisabled(), false);
  await writeFile(path.join(evidence, 'conversion-error.txt'), report);
  await failure.page.screenshot({ path: path.join(evidence, 'error-desktop.png'), fullPage: true });
  results.push({ test: 'failed-multi-and-single-attempts-preserve-errors-and-logs', passed: true });

  await failure.context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await failure.page.locator('#copy-error-details').click();
  await failure.page.waitForFunction(() => document.getElementById('copy-error-status').textContent.length > 0);
  assert.equal(await failure.page.evaluate(() => navigator.clipboard.readText()), report);
  results.push({ test: 'copy-button-copies-exact-report', passed: true });

  await failure.page.evaluate(() => {
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async () => { throw new DOMException('Permission denied', 'NotAllowedError'); } } });
  });
  await failure.page.locator('#copy-error-details').click();
  await failure.page.waitForFunction(() => {
    const report = document.getElementById('error-report');
    return document.activeElement === report && report.selectionStart === 0 && report.selectionEnd === report.value.length;
  });
  assert.match(await failure.page.locator('#copy-error-status').textContent(), /コピー/);
  results.push({ test: 'clipboard-denial-selects-report-for-manual-copy', passed: true });

  await failure.page.setViewportSize({ width: 390, height: 844 });
  await failure.page.locator('#error').scrollIntoViewIfNeeded();
  assert.equal(await failure.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'Mobile error UI should not cause horizontal page overflow');
  await failure.page.screenshot({ path: path.join(evidence, 'error-mobile.png'), fullPage: true });
  results.push({ test: 'mobile-error-layout-fits-390px', passed: true });

  await failure.page.locator('#file-input').setInputFiles({ name: 'empty.mov', mimeType: 'video/quicktime', buffer: Buffer.alloc(0) });
  await failure.page.waitForFunction(() => document.getElementById('error-message').textContent.includes('空'));
  const validationReport = await failure.page.locator('#error-report').inputValue();
  assert.equal(validationReport.includes('Injected'), false, 'Validation report must not reuse previous exception');
  assert.equal(validationReport.includes('Decoder diagnostic'), false, 'Validation report must not reuse previous FFmpeg logs');
  assert.doesNotMatch(validationReport, /(?:width|height|codec|audio):/, 'Validation report must not reuse previous video metadata');
  assert.match(validationReport, /extension: mov/);
  assert.match(validationReport, /size: 0/);
  results.push({ test: 'new-file-validation-clears-old-diagnostics', passed: true });

  await failure.page.evaluate(() => { window.engineFault = null; });
  await sample(failure.page);
  assert.equal(await failure.page.locator('#error-report').inputValue(), '');
  await failure.page.locator('#convert').click();
  await failure.page.waitForFunction(() => !document.getElementById('result-card').hidden || !document.getElementById('error').hidden);
  assert.equal(await failure.page.locator('#error').isVisible(), false, await failure.page.locator('#error-message').textContent());
  assert.equal(await failure.page.locator('#result-card').isVisible(), true);
  const downloadPromise = failure.page.waitForEvent('download');
  await failure.page.locator('#download').click();
  await (await downloadPromise).saveAs(path.join(evidence, 'retry.mp4'));
  results.push({ test: 'retry-converts-real-sample-and-clears-diagnostics', passed: true });
  assert.deepEqual(failure.pageErrors, []);
  await failure.context.close();

  const loadFailure = await openPage();
  await loadFailure.page.evaluate(() => { window.engineFault = { type: 'LOAD', mode: 'multi' }; });
  await sample(loadFailure.page);
  assert.deepEqual(await loadFailure.page.evaluate(() => engineLoads), ['multi', 'single']);
  await loadFailure.page.evaluate(() => { window.engineFault = { type: 'EXEC' }; });
  await loadFailure.page.locator('#convert').click();
  const loadReport = await visibleReport(loadFailure.page);
  assert.match(loadReport, /Injected multi LOAD failure/);
  assert.match(loadReport, /Injected single EXEC failure/);
  await writeFile(path.join(evidence, 'load-fallback-error.txt'), loadReport);
  results.push({ test: 'initialization-fallback-preserved-in-later-conversion-error', passed: true });

  await loadFailure.page.evaluate(() => { window.engineFault = { type: 'EXEC', exitCode: 1 }; });
  await loadFailure.page.locator('#convert').click();
  const exitReport = await visibleReport(loadFailure.page);
  assert.match(exitReport, /exitCode: 1/);
  assert.match(exitReport, /Decoder diagnostic single: unsupported test packet/);
  assert.match(exitReport, /output\.mp4/);
  assert.doesNotMatch(exitReport, /Injected multi LOAD failure/, 'A discarded engine must not leave stale initialization errors');
  assert.deepEqual(loadFailure.pageErrors, []);
  await loadFailure.context.close();
  results.push({ test: 'nonzero-conversion-result-shows-exit-code-and-log', passed: true });

  const cancelled = await openPage();
  await sample(cancelled.page);
  await cancelled.page.evaluate(() => { window.engineFault = { type: 'EXEC', delay: 800 }; });
  await cancelled.page.locator('#convert').click();
  await cancelled.page.waitForFunction(() => engineCommands.length > 0);
  await cancelled.page.locator('#cancel').click();
  await cancelled.page.waitForTimeout(1000);
  assert.equal(await cancelled.page.locator('#error').isVisible(), false);
  assert.equal(await cancelled.page.locator('#error-report').inputValue(), '');
  assert.equal(await cancelled.page.locator('#status-card').isVisible(), false);
  assert.equal(await cancelled.page.locator('#convert').isDisabled(), false);
  assert.deepEqual(cancelled.pageErrors, []);
  await cancelled.context.close();
  results.push({ test: 'cancelled-conversion-does-not-show-error', passed: true });
  const summary = { baseURL, browser: browser.version(), environment: env, results };
  await writeFile(path.join(evidence, 'results.json'), JSON.stringify(summary, null, 2) + '\n');
  console.log(JSON.stringify(summary, null, 2));
}

try {
  await Promise.race([
    runChecks(),
    new Promise((_, reject) => { deadline = setTimeout(() => reject(new Error('Error UI checks exceeded 180 seconds')), 180000); }),
  ]);
} finally {
  clearTimeout(deadline);
  await browser.close();
}
