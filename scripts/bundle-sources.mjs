import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, copyFile, rename } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const directory = `${root}dist/sources`;
const manifest = JSON.parse(await readFile(`${root}release-sources/manifest.json`, 'utf8'));
const sha256 = data => createHash('sha256').update(data).digest('hex');
await mkdir(directory, { recursive: true });

async function download(source) {
  const destination = `${directory}/${source.file}`;
  try {
    if (sha256(await readFile(destination)) === source.sha256) return;
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const response = await fetch(source.url, { signal: AbortSignal.timeout(180_000) });
  if (!response.ok) throw new Error(`Source download failed: ${source.name} (${response.status})`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (sha256(bytes) !== source.sha256) throw new Error(`Source checksum mismatch: ${source.name}`);
  await writeFile(`${destination}.part`, bytes);
  await rename(`${destination}.part`, destination);
  console.log(`Bundled source: ${source.name}`);
}
for (let i = 0; i < manifest.sources.length; i += 4) {
  await Promise.all(manifest.sources.slice(i, i + 4).map(download));
}
for (const file of ['manifest.json', 'README.txt', 'Dockerfile.upstream', 'prepare-build.py']) {
  await copyFile(`${root}release-sources/${file}`, `${directory}/${file}`);
}
const entries = manifest.sources.map(source => `<li><a href="./${source.file}">${source.name}</a> (${(source.size / 1e6).toFixed(1)} MB) — <code>${source.commit}</code></li>`).join('\n');
await writeFile(`${directory}/index.html`, `<!doctype html>
<html lang="ja"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="referrer" content="no-referrer"><title>Maitake — ライセンスとソース</title>
<style>body{max-width:960px;margin:48px auto;padding:0 24px;font:16px/1.9 system-ui;color:#25392e;background:#f8faf8}a{color:#315d44}code{font-size:12px;overflow-wrap:anywhere}li{margin:10px 0}h1{font-size:26px}</style>
<a href="../">← Maitake</a><h1>ライセンスとソースコード</h1>
<p>Maitakeで使用する変換ライブラリの対応ソース、ビルド手順、元のライセンス・著作権表示を配布しています。ダウンロードに登録は不要です。</p>
<p><a href="../third-party-notices.txt">ライセンス表示</a> · <a href="./README.txt">ビルド手順</a> · <a href="./prepare-build.py">ソース取得・展開スクリプト</a> · <a href="./manifest.json">バージョン・SHA-256一覧</a> · <a href="https://github.com/AtsushiSakai/Maitake">Maitakeのソース</a></p>
<p>FFmpeg core ${manifest.coreVersion} / wrapper ${manifest.wrapperVersion}。以下は閲覧者が明示的に取得する開発用ソースです。通常の動画変換では読み込みません。</p><ul>${entries}</ul></html>`);
console.log(`Release sources verified: ${manifest.sources.length} archives.`);
