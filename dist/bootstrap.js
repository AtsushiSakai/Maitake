// GitHub Pages cannot supply COOP/COEP response headers. The same-origin
// service worker supplies them within this app's directory only.
async function prepareIsolation() {
  if (globalThis.crossOriginIsolated || !globalThis.isSecureContext || !navigator.serviceWorker) return;
  const workerURL = new URL('./coi-serviceworker.js', import.meta.url);
  const scope = new URL('./', import.meta.url).href;
  const key = `maitake-isolation-attempt:${scope}`;
  try {
    // A failed isolation attempt must never cause a reload loop.
    if (sessionStorage.getItem(key)) return;
    let timer, onChange;
    const controlled = new Promise(resolve => {
      onChange = () => {
        if (navigator.serviceWorker.controller?.scriptURL === workerURL.href) resolve(true);
      };
      navigator.serviceWorker.addEventListener('controllerchange', onChange);
      timer = setTimeout(() => resolve(false), 4000);
    });
    let ready = false;
    try {
      // Include registration in the deadline: blocked service workers must not
      // keep the converter's controls disabled indefinitely.
      const registration = navigator.serviceWorker.register(workerURL, { scope });
      registration.then(onChange, () => {});
      ready = await controlled;
    } finally {
      clearTimeout(timer);
      navigator.serviceWorker.removeEventListener('controllerchange', onChange);
    }
    if (ready) {
      sessionStorage.setItem(key, '1');
      location.reload();
      // Do not activate file selection in the old document while reloading.
      await new Promise(() => {});
    }
  } catch {
    // Storage or worker restrictions leave the original single-thread engine usable.
  }
}

const preventEarlyDrop = event => { if (event.dataTransfer?.types.includes('Files')) event.preventDefault(); };
document.addEventListener('dragover', preventEarlyDrop);
document.addEventListener('drop', preventEarlyDrop);
await prepareIsolation();
await import('./app.js');
document.removeEventListener('dragover', preventEarlyDrop);
document.removeEventListener('drop', preventEarlyDrop);
