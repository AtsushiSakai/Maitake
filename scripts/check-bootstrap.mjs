import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const baseURL = process.env.TEST_BASE_URL;
if (!baseURL || new URL(baseURL).pathname === '/') throw new Error('TEST_BASE_URL must include the app subdirectory');
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH, headless: true });
const results = [];
try {
  for (const late of [false, true]) {
    const context = await browser.newContext();
    if (late) await context.addInitScript(() => {
      const original = navigator.serviceWorker.register.bind(navigator.serviceWorker);
      navigator.serviceWorker.register = async (...args) => {
        await new Promise(resolve => setTimeout(resolve, 5000));
        return original(...args);
      };
    });
    const page = await context.newPage();
    page.setDefaultTimeout(20000);
    let navigations = 0;
    page.on('framenavigated', frame => { if (frame === page.mainFrame()) navigations++; });
    await page.goto(baseURL);
    await page.waitForFunction(() => !document.getElementById('choose').disabled);
    const initial = await page.evaluate(() => crossOriginIsolated);
    assert.equal(initial, !late);
    const navigationCount = navigations;
    if (late) {
      await page.evaluate(() => { window.preservedSelectionMarker = 'keep'; });
      await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
      assert.equal(navigations, navigationCount);
      assert.equal(await page.evaluate(() => window.preservedSelectionMarker), 'keep');
      assert.equal(await page.evaluate(() => crossOriginIsolated), false);
    }
    const scope = await page.evaluate(async () => (await navigator.serviceWorker.getRegistration()).scope);
    assert.equal(scope, baseURL);
    assert.equal(await page.evaluate(async () => Boolean(await navigator.serviceWorker.getRegistration('/outside-maitake/'))), false);
    await page.reload();
    await page.waitForFunction(() => !document.getElementById('choose').disabled);
    assert.equal(await page.evaluate(() => crossOriginIsolated), true);
    results.push({ lateRegistration: late, initialIsolated: initial, initialNavigations: navigationCount, scope, reloadIsolated: true });
    await context.close();
  }
  await mkdir('evidence/bootstrap', { recursive: true });
  await writeFile('evidence/bootstrap/results.json', JSON.stringify(results, null, 2) + '\n');
  console.log(JSON.stringify(results, null, 2));
} finally { await browser.close(); }
