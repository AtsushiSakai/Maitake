import { cp, mkdir, writeFile, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
await mkdir(`${root}dist/vendor`, { recursive: true });
await cp(`${root}node_modules/@ffmpeg/ffmpeg/dist/esm`, `${root}dist/vendor/ffmpeg`, { recursive: true });
await cp(`${root}node_modules/@ffmpeg/core/dist/esm`, `${root}dist/vendor/core`, { recursive: true });
await writeFile(`${root}dist/.nojekyll`, '');
const packages = await Promise.all(['ffmpeg', 'core'].map(async name => {
  const pkg = JSON.parse(await readFile(`${root}node_modules/@ffmpeg/${name}/package.json`, 'utf8'));
  return { package: pkg.name, version: pkg.version, license: pkg.license };
}));
await writeFile(`${root}dist/vendor/versions.json`, JSON.stringify(packages, null, 2));
console.log('Static site ready in dist/ (all conversion libraries are served locally).');
