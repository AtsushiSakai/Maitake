import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = fileURLToPath(new URL('../', import.meta.url));
const baseURL = process.env.TEST_BASE_URL || 'http://127.0.0.1:4173/';
const evidence = path.resolve(process.env.EVIDENCE_DIR || path.join(root, 'evidence/smoke'));
await mkdir(evidence, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH, headless: true });
const results = [];
async function openPage(options = {}) {
  const context = await browser.newContext(options);
  await context.addInitScript(() => {
    window.engineLoads = []; window.engineCommands = []; window.engineFault = null;
    const NativeWorker = window.Worker;
    window.Worker = class extends NativeWorker {
      terminated = false;
      postMessage(message, ...rest) {
        if (message?.type === 'LOAD') window.engineLoads.push(message.data);
        if (message?.type === 'EXEC') window.engineCommands.push(message.data.args);
        const fault = window.engineFault;
        if (fault && !fault.used && message?.type === fault.type) {
          fault.used = true;
          setTimeout(() => {
            if (!this.terminated) this.dispatchEvent(new MessageEvent('message', { data: { id: message.id, type: 'ERROR', data: 'Injected parallel engine failure' } }));
          }, fault.delay || 0);
          return;
        }
        return super.postMessage(message, ...rest);
      }
      terminate() { this.terminated = true; return super.terminate(); }
    };
  });
  const page = await context.newPage();
  page.setDefaultTimeout(180000);
  const warnings = [];
  page.on('console', message => { if (message.type() === 'warning') warnings.push(message.text()); });
  await page.goto(baseURL);
  await page.waitForFunction(() => !document.getElementById('choose').disabled);
  return { context, page, warnings };
}
async function sample(page) {
  await page.locator('#sample').click();
  await page.waitForFunction(() => !document.getElementById('convert').disabled || !document.getElementById('error').hidden);
  assert.equal(await page.locator('#error').isVisible(), false, await page.locator('#error').textContent());
}
async function convert(page, name) {
  await page.locator('#convert').click();
  await page.waitForFunction(() => !document.getElementById('result-card').hidden || !document.getElementById('error').hidden);
  assert.equal(await page.locator('#error').isVisible(), false, await page.locator('#error').textContent());
  const downloadPromise = page.waitForEvent('download');
  await page.locator('#download').click();
  const download = await downloadPromise;
  await download.saveAs(path.join(evidence, name));
  return await page.locator('#result-description').textContent();
}
try {
  const normal = await openPage();
  const env = await normal.page.evaluate(async () => ({ isolated: crossOriginIsolated, sab: typeof SharedArrayBuffer, cores: navigator.hardwareConcurrency, memory: navigator.deviceMemory, scope: (await navigator.serviceWorker.getRegistration()).scope, ua: navigator.userAgent }));
  assert.equal(env.isolated, true);
  assert.equal(env.scope, baseURL);
  await normal.page.reload();
  await normal.page.waitForFunction(() => !document.getElementById('choose').disabled);
  assert.equal(await normal.page.evaluate(() => crossOriginIsolated), true);
  for (const format of ['mp4', 'mov', 'avi', 'webm']) {
    await sample(normal.page);
    await normal.page.locator(`input[name="format"][value="${format}"]`).check();
    results.push({ test: `multi-${format}`, result: await convert(normal.page, `multi.${format}`) });
  }
  assert.equal(normal.warnings.some(x => x.includes('Parallel')), false, normal.warnings.join('\n'));
  assert.equal(await normal.page.evaluate(() => engineLoads.length === 4 && engineLoads.every(x => x.coreURL.includes('/core-mt/')) && engineCommands.every(x => Number(x[x.indexOf('-threads') + 1]) > 1)), true);
  await normal.page.screenshot({ path: path.join(evidence, 'preview.png'), fullPage: true });
  await normal.context.close();
  for (const fault of ['load', 'exec']) {
    const fixture = await openPage();
    await fixture.page.evaluate(fault => { window.engineFault = { type: fault.toUpperCase() }; }, fault);
    await sample(fixture.page);
    results.push({ test: `${fault}-fallback`, result: await convert(fixture.page, `${fault}-fallback.mp4`) });
    assert.equal(fixture.warnings.some(x => x.includes('Parallel')), true);
    assert.deepEqual(await fixture.page.evaluate(() => engineLoads.map(x => x.coreURL.includes('/core-mt/') ? 'multi' : 'single')), ['multi', 'single']);
    await fixture.context.close();
  }
  const plain = await openPage({ serviceWorkers: 'block' });
  assert.equal(await plain.page.evaluate(() => crossOriginIsolated), false);
  await sample(plain.page);
  results.push({ test: 'no-isolation-single', result: await convert(plain.page, 'single.mp4') });
  assert.equal(await plain.page.evaluate(() => engineLoads.every(x => x.coreURL.includes('/core/'))), true);
  await plain.context.close();
  for (const stage of ['prepare', 'convert']) {
    const fixture = await openPage();
    await fixture.page.evaluate(stage => { window.engineFault = { type: stage === 'prepare' ? 'LOAD' : 'EXEC', delay: 800 }; }, stage);
    if (stage === 'prepare') await fixture.page.locator('#sample').click();
    else { await sample(fixture.page); await fixture.page.locator('#convert').click(); }
    await fixture.page.locator('#status-card').waitFor({ state: 'visible' });
    await fixture.page.locator('#cancel').click();
    await fixture.page.waitForTimeout(1100);
    assert.equal(await fixture.page.locator('#status-card').isVisible(), false);
    assert.equal(await fixture.page.locator('#error').isVisible(), false);
    assert.equal(fixture.warnings.some(x => x.includes('Parallel')), false);
    if (stage === 'prepare') await sample(fixture.page);
    results.push({ test: `cancel-${stage}-retry`, result: await convert(fixture.page, `cancel-${stage}.mp4`) });
    await fixture.context.close();
  }
  if (process.env.SMOKE_INPUT) {
    const fixture = await openPage();
    await fixture.page.locator('#file-input').setInputFiles(process.env.SMOKE_INPUT);
    await fixture.page.waitForFunction(() => !document.getElementById('convert').disabled);
    await fixture.page.locator('#convert').click();
    await fixture.page.waitForFunction(() => Number(document.getElementById('progress').getAttribute('aria-valuenow')) > 0);
    await fixture.page.locator('#cancel').click();
    await fixture.page.waitForTimeout(1000);
    assert.equal(await fixture.page.locator('#status-card').isVisible(), false);
    assert.equal(await fixture.page.locator('#result-card').isVisible(), false);
    assert.equal(await fixture.page.locator('#error').isVisible(), false);
    await sample(fixture.page);
    results.push({ test: 'cancel-real-conversion-retry', result: await convert(fixture.page, 'cancel-real.mp4') });
    assert.equal(fixture.warnings.some(x => x.includes('Parallel')), false);
    await fixture.context.close();
  }
  const report = { baseURL, browser: browser.version(), environment: env, results };
  await writeFile(path.join(evidence, 'results.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
} finally { await browser.close(); }
