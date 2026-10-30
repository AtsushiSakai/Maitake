import { FFmpeg } from './vendor/ffmpeg/index.js';
import { FORMATS, QUALITIES, MAX_OUTPUT_BYTES, validateFile, extension, outputName, summarizeProbe, buildArgs } from './recipes.js';
import { selectEngineConfig, coreURLs } from './engine-config.js';

const $ = id => document.getElementById(id);
let source = null, info = null, engine = null, prepared = false, busy = false;
let generation = 0, inputURL = null, outputURL = null, progressTimer = null, phase = '', lastPercent = 0;
let format = 'mp4', quality = 'medium';
let engineConfig = { mode: 'single', threads: 1 }, singleThreadOnly = false;
const logs = [];
const filesize = n => n < 1_000_000 ? `${(n / 1000).toFixed(0)} KB` : `${(n / 1_000_000).toFixed(1)} MB`;
const duration = n => !n ? '長さ不明' : `${Math.floor(Math.round(n) / 60)}:${String(Math.round(n) % 60).padStart(2, '0')}`;
const assetURL = name => new URL(name, import.meta.url).href;
function assertCurrent(id) { if (id !== generation) throw new DOMException('Cancelled', 'AbortError'); }
function setBusy(value) {
  busy = value;
  for (const id of ['choose', 'sample', 'file-input', 'remove-file', 'format-options', 'quality-options']) $(id).disabled = value;
  $('convert').disabled = value || !source || !info;
  if (value) $('convert-hint').textContent = 'このタブを開いたままお待ちください。';
  else $('convert-hint').textContent = source && info ? '動画は外部に送信されません。' : 'まずは、変換する動画を選んでください。';
}
function showError(message) { $('error').textContent = message; $('error').hidden = false; }
function clearError() { $('error').hidden = true; $('error').textContent = ''; }
function releaseEngine() { if (engine) engine.terminate(); engine = null; prepared = false; }
function clearResult() {
  $('output-preview').pause(); $('output-preview').removeAttribute('src'); $('output-preview').load();
  $('result-card').hidden = true; $('download').removeAttribute('href');
  if (outputURL) URL.revokeObjectURL(outputURL); outputURL = null;
}
function status(title, description, determinate = false) {
  $('status-card').hidden = false;
  $('status-title').textContent = title;
  $('status-description').textContent = description;
  $('progress').classList.toggle('indeterminate', !determinate);
  if (!determinate) { $('progress').removeAttribute('aria-valuenow'); $('progress-text').textContent = ''; }
}
function renderSettings() {
  $('convert').querySelector('span').textContent = `${FORMATS[format].title}に変換`;
  $('output-summary').textContent = `${FORMATS[format].title} ／ 品質：${QUALITIES[quality].title}`;
  $('codec-label').textContent = FORMATS[format].codec;
  $('format-note').textContent = FORMATS[format].note;
  $('quality-description').textContent = { high: '元の解像度・フレームレートを維持。画質を優先します。', medium: '最大1080p・30fps。画質とサイズのちょうどいいバランス。', light: '最大720p・30fps。容量を抑えて、共有しやすい動画に。' }[quality];
  if (format === 'avi') $('quality-description').textContent += ' AVIは容量が大きくなります。';
}
function renderInfo() {
  $('file-meta').textContent = `${filesize(source.size)}${info ? ` · ${info.width} × ${info.height} · ${duration(info.duration)}` : ''}`;
  $('source-details').textContent = info ? `${(info.codec || '').toUpperCase()}${info.audio ? ` / ${info.audio.toUpperCase()}` : ' / 音声なし'}${info.fps ? ` · ${Number(info.fps.toFixed(2))} fps` : ''} · ブラウザ内で読み込み済み` : '動画の情報を確認しています…';
}
async function readProbe(ff, path, id, out = 'metadata.json') {
  const code = await ff.ffprobe(['-v', 'error', '-show_streams', '-show_format', '-of', 'json', path, '-o', out]);
  assertCurrent(id);
  // core 0.12.10 can leave ret at -1 after a successful ffprobe. Validate its JSON,
  // rather than accepting the return value alone as proof of successful probing.
  if (code !== 0 && code !== -1) throw new Error('動画を読み込めませんでした。未対応の形式、または壊れたファイルの可能性があります。');
  try {
    const text = await ff.readFile(out, 'utf8');
    assertCurrent(id);
    await ff.deleteFile(out);
    return summarizeProbe(JSON.parse(text));
  } catch (error) {
    assertCurrent(id);
    throw new Error('動画の情報を読み込めませんでした。未対応の形式、または壊れたファイルの可能性があります。');
  }
}
async function prepare(id) {
  if (prepared && engine?.loaded) return engine;
  status('変換プログラムを準備しています…', '初回は約32MBを読み込みます。動画は送信されません。');
  engineConfig = selectEngineConfig({ isolated: globalThis.crossOriginIsolated, sharedArrayBuffer: typeof SharedArrayBuffer !== 'undefined', hardwareConcurrency: navigator.hardwareConcurrency, deviceMemory: navigator.deviceMemory }, singleThreadOnly);
  const ff = new FFmpeg(); engine = ff;
  ff.on('log', ({ message }) => { if (id === generation) { logs.push(message); if (logs.length > 40) logs.shift(); } });
  ff.on('progress', ({ time }) => {
    if (id !== generation || phase !== 'converting' || !info?.duration || time < 0) return;
    lastPercent = Math.max(lastPercent, Math.min(99, Math.floor((time / 1_000_000) / info.duration * 100)));
    $('progress-fill').style.width = `${lastPercent}%`;
    $('progress').setAttribute('aria-valuenow', lastPercent);
  });
  let loadTimer;
  try {
    await Promise.race([ff.load(coreURLs(engineConfig, import.meta.url)), new Promise((_, reject) => { loadTimer = setTimeout(() => reject(new Error('変換プログラムの読み込みに時間がかかっています。接続を確認し、もう一度お試しください。')), 120_000); })]);
    clearTimeout(loadTimer);
    assertCurrent(id);
    status('動画の形式を確認しています…', 'ファイルの中身を、このブラウザ内で確認しています。');
    await ff.createDir('/input'); assertCurrent(id);
    // WORKERFS reads slices of a local File, avoiding a full input copy in WASM memory.
    const localFile = new File([source], `source.${extension(source.name)}`, { type: source.type });
    const mounted = await ff.mount('WORKERFS', { files: [localFile] }, '/input'); assertCurrent(id);
    if (!mounted) throw new Error('動画の読み込みに失敗しました。ページを再読み込みしてください。');
    const path = `/input/${localFile.name}`;
    info = await readProbe(ff, path, id); assertCurrent(id);
    if (info.hdr) throw new Error('このバージョンはHDR動画の変換に対応していません。通常のSDR動画を選んでください。');
    prepared = true; renderInfo();
    return ff;
  } catch (error) {
    assertCurrent(id);
    if (engineConfig.mode !== 'multi') throw error;
    // A fresh worker releases the shared heap and partially mounted input.
    console.warn('[Maitake] Parallel engine unavailable; retrying the standard engine.', String(error));
    singleThreadOnly = true; releaseEngine();
    return await prepare(id);
  } finally { clearTimeout(loadTimer); }
}
async function executeConversion(id, selectedFormat, selectedQuality) {
  for (;;) {
    const ff = await prepare(id); assertCurrent(id);
    const inputInfo = { ...info };
    phase = 'converting';
    status(`${FORMATS[selectedFormat].title}に変換しています…`, 'このタブを閉じずにお待ちください。キャンセルはいつでもできます。', !!info.duration);
    $('progress-fill').style.width = '0%'; $('progress').setAttribute('aria-valuenow', '0');
    try {
      const result = await ff.exec(buildArgs({ input: `/input/source.${extension(source.name)}`, format: selectedFormat, quality: selectedQuality, info, threads: engineConfig.threads }));
      assertCurrent(id);
      if (result !== 0) throw new Error('変換に失敗しました。未対応の圧縮形式、またはメモリ不足の可能性があります。別の形式や「軽量」でお試しください。');
      return { ff, inputInfo };
    } catch (error) {
      assertCurrent(id);
      if (engineConfig.mode !== 'multi') throw error;
      // Retry only once, preserving settings and discarding all partial output.
      console.warn('[Maitake] Parallel conversion failed; retrying the standard engine.', String(error));
      singleThreadOnly = true; releaseEngine(); lastPercent = 0; phase = 'preparing';
    }
  }
}
async function selectFile(file) {
  if (busy || !file) return;
  clearError();
  try { validateFile(file); } catch (error) { showError(error.message); return; }
  const id = ++generation;
  releaseEngine(); clearResult();
  if (inputURL) URL.revokeObjectURL(inputURL);
  source = file; info = null; phase = 'inspecting';
  $('dropzone').hidden = true; $('selected-file').hidden = false;
  $('file-name').textContent = file.name;
  $('file-type').textContent = extension(file.name).toUpperCase();
  inputURL = URL.createObjectURL(file);
  $('input-preview').hidden = false; $('preview-unavailable').hidden = true;
  $('input-preview').src = inputURL;
  renderInfo(); setBusy(true);
  try {
    await prepare(id); assertCurrent(id);
    $('status-card').hidden = true;
  } catch (error) {
    if (id !== generation) return;
    releaseEngine(); info = null;
    $('source-details').textContent = 'このファイルの形式を確認できませんでした。';
    showError(friendlyError(error)); $('status-card').hidden = true;
  } finally { if (id === generation) { phase = ''; setBusy(false); } }
}
function friendlyError(error) {
  const text = String(error?.message || error);
  if (/out of memory|cannot enlarge|allocation/i.test(text)) return 'ブラウザのメモリが不足しました。小さい動画や「軽量」でお試しください。';
  if (/out of bounds|Aborted\(/i.test(text)) return '変換エンジンでエラーが発生しました。別の出力形式や「軽量」でお試しください。';
  if (/fetch|network|import|Failed to load/i.test(text)) return '変換プログラムを読み込めませんでした。接続を確認して、ページを再読み込みしてください。';
  return /[ぁ-んァ-ヶ一-龠]/.test(text) ? text : 'この動画を変換できませんでした。未対応の圧縮形式、またはメモリ不足の可能性があります。小さい動画や別の形式でお試しください。';
}
async function convert() {
  if (busy || !source || !info) return;
  clearError(); clearResult();
  // Keep the generation while reusing a prepared engine and its progress callbacks.
  const id = generation, selectedFormat = format, selectedQuality = quality;
  setBusy(true); lastPercent = 0; phase = 'preparing';
  $('input-preview').pause();
  try {
    const started = performance.now();
    const tick = () => { $('progress-text').textContent = `${info.duration ? `${lastPercent}% · ` : ''}${Math.floor((performance.now() - started) / 1000)}秒経過`; };
    tick(); progressTimer = setInterval(tick, 1000);
    const { ff, inputInfo } = await executeConversion(id, selectedFormat, selectedQuality);
    assertCurrent(id); phase = 'finishing';
    clearInterval(progressTimer); progressTimer = null;
    status('変換した動画を確認しています…', 'ファイルを確認して、保存できるようにしています。');
    const outputPath = `output.${selectedFormat}`;
    const verified = await readProbe(ff, outputPath, id, 'output-metadata.json'); assertCurrent(id);
    const data = await ff.readFile(outputPath); assertCurrent(id);
    if (!data.length || data.length >= MAX_OUTPUT_BYTES || (inputInfo.duration > 0 && verified.duration > 0 && verified.duration < inputInfo.duration - Math.max(0.75, 3 / (inputInfo.fps || 24)))) {
      throw new Error('出力上限の600MBに達したか、動画の途中で変換が止まりました。途中の動画は保存しません。MP4・WebM、または「軽量」でお試しください。');
    }
    const blob = new Blob([data], { type: FORMATS[selectedFormat].mime });
    outputURL = URL.createObjectURL(blob);
    $('download').href = outputURL; $('download').download = outputName(source.name, selectedFormat, selectedQuality);
    $('download').querySelector('span').textContent = `${FORMATS[selectedFormat].title}を保存`;
    const ratio = (1 - blob.size / source.size) * 100;
    const reduction = ratio >= 99.9 ? '99.9%以上' : `${ratio.toFixed(1).replace(/\.0$/, '')}%`;
    const change = ratio >= 0.1 ? `元より${reduction}小さく` : ratio <= -0.1 ? `元の${(blob.size / source.size).toFixed(1)}倍` : '元とほぼ同じ容量';
    $('result-description').textContent = `${FORMATS[selectedFormat].title} · ${filesize(blob.size)} · ${verified.width} × ${verified.height} · ${change}`;
    const previewable = ['mp4', 'webm'].includes(selectedFormat);
    $('output-preview').hidden = !previewable; $('output-preview-note').hidden = previewable;
    $('output-preview-note').textContent = 'この形式はブラウザでプレビューできません。保存して対応プレーヤーで再生してください。';
    if (previewable) $('output-preview').src = outputURL;
    $('result-card').hidden = false; $('status-card').hidden = true;
    releaseEngine();
  } catch (error) {
    if (id !== generation) return;
    console.warn('[Maitake] Local conversion diagnostic:', String(error), logs.join('\n'));
    showError(friendlyError(error)); releaseEngine(); $('status-card').hidden = true;
  } finally {
    if (id === generation) { clearInterval(progressTimer); progressTimer = null; phase = ''; setBusy(false); }
  }
}
function cancel() {
  const wasInspecting = phase === 'inspecting' || !info;
  generation++; releaseEngine(); clearInterval(progressTimer); progressTimer = null; phase = '';
  $('status-card').hidden = true; setBusy(false);
  if (wasInspecting) { info = null; $('source-details').textContent = '読み込みをキャンセルしました。動画を選び直してください。'; }
  else $('convert-hint').textContent = 'キャンセルしました。設定を変えて、もう一度変換できます。';
}
function removeFile() {
  if (busy) return;
  generation++; releaseEngine(); clearResult(); clearError();
  source = null; info = null; $('input-preview').pause(); $('input-preview').removeAttribute('src'); $('input-preview').load();
  if (inputURL) URL.revokeObjectURL(inputURL); inputURL = null;
  $('file-input').value = ''; $('selected-file').hidden = true; $('dropzone').hidden = false; $('status-card').hidden = true; setBusy(false);
}
$('choose').addEventListener('click', () => $('file-input').click());
$('file-input').addEventListener('change', event => { const file = event.target.files[0]; event.target.value = ''; void selectFile(file); });
$('remove-file').addEventListener('click', removeFile);
$('input-preview').addEventListener('error', () => { if (source) { $('input-preview').hidden = true; $('preview-unavailable').hidden = false; } });
$('output-preview').addEventListener('error', () => { $('output-preview').hidden = true; $('output-preview-note').hidden = false; $('output-preview-note').textContent = 'このブラウザでプレビューできません。保存して対応プレーヤーで再生してください。'; });
$('convert').addEventListener('click', () => void convert());
$('cancel').addEventListener('click', cancel);
document.querySelectorAll('input[name="format"],input[name="quality"]').forEach(input => input.addEventListener('change', () => {
  if (busy) return;
  format = document.querySelector('input[name="format"]:checked').value;
  quality = document.querySelector('input[name="quality"]:checked').value;
  clearResult(); renderSettings();
}));
let dragDepth = 0;
document.addEventListener('dragover', e => { if (e.dataTransfer?.types.includes('Files')) e.preventDefault(); });
document.addEventListener('drop', e => { if (e.dataTransfer?.types.includes('Files')) e.preventDefault(); });
const dropTarget = $('converter');
dropTarget.addEventListener('dragenter', e => { if (e.dataTransfer?.types.includes('Files')) { e.preventDefault(); dragDepth++; if (!busy) $('dropzone').classList.add('dragging'); } });
dropTarget.addEventListener('dragleave', () => { if (--dragDepth <= 0) { dragDepth = 0; $('dropzone').classList.remove('dragging'); } });
dropTarget.addEventListener('drop', e => { e.preventDefault(); dragDepth = 0; $('dropzone').classList.remove('dragging'); if (busy) return; if (e.dataTransfer.files.length !== 1) showError('動画は1ファイルずつ選んでください。'); else void selectFile(e.dataTransfer.files[0]); });
$('sample').addEventListener('click', async () => {
  if (busy) return;
  const id = generation; setBusy(true); clearError();
  try {
    const response = await fetch(assetURL('./assets/sample.webm'));
    if (!response.ok) throw new Error('サンプルを読み込めませんでした。');
    const blob = await response.blob(); assertCurrent(id); setBusy(false);
    await selectFile(new File([blob], 'quiet-coast.webm', { type: 'video/webm' }));
  } catch (error) { if (id === generation) { setBusy(false); showError(friendlyError(error)); } }
});
$('privacy-open').addEventListener('click', () => $('privacy-dialog').showModal());
$('privacy-close').addEventListener('click', () => $('privacy-dialog').close());
$('privacy-dialog').addEventListener('click', e => { if (e.target === $('privacy-dialog')) { const r = e.target.getBoundingClientRect(); if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) e.target.close(); } });
window.addEventListener('beforeunload', e => { if (busy) { e.preventDefault(); e.returnValue = ''; } });
renderSettings(); setBusy(false);
