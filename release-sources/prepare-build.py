"""Fetch and prepare Maitake's corresponding FFmpeg source (Python 3.12+)."""
import argparse
import hashlib
import json
import re
import shutil
import tarfile
import urllib.request
from pathlib import Path

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--base-url', default='https://atsushisakai.github.io/Maitake/sources/')
parser.add_argument('--output', type=Path, default=Path('maitake-core-source'))
args = parser.parse_args()
base = args.base_url.rstrip('/') + '/'
args.output.mkdir(parents=True, exist_ok=True)
manifest = json.load(urllib.request.urlopen(base + 'manifest.json'))
context = args.output / 'build-context'
if context.exists():
    raise SystemExit('build-context already exists; choose a new --output directory.')
trees = {}
for source in manifest['sources']:
    archive = args.output / source['file']
    if not archive.exists():
        urllib.request.urlretrieve(base + source['file'], archive)
    if hashlib.sha256(archive.read_bytes()).hexdigest() != source['sha256']:
        raise SystemExit('Checksum mismatch: ' + source['name'])
    target = args.output / source['name']
    target.mkdir(exist_ok=True)
    with tarfile.open(archive) as bundle:
        bundle.extractall(target, filter='data')
    trees[source['name']] = next(target.iterdir())
shutil.copytree(trees['ffmpeg-wasm'], context)
for source in manifest['sources']:
    if source['name'] in ('ffmpeg-wasm', 'emscripten', 'emsdk', 'sdl2', 'googletest'):
        continue
    shutil.copytree(trees[source['name']], context / 'vendor-src' / source['name'])
test_source = context / 'vendor-src/zimg/test/extra/googletest'
shutil.copytree(trees['googletest'], test_source, dirs_exist_ok=True)
dockerfile = context / 'Dockerfile'
text = dockerfile.read_text()
for source in manifest['sources']:
    pattern = r'ADD https://github\.com/' + re.escape(source['repository']) + r'\.git#\$\w+ /src'
    text = re.sub(pattern, f'COPY vendor-src/{source["name"]} /src', text)
text = text.replace('RUN git clone --recursive -b $ZIMG_BRANCH https://github.com/sekrit-twc/zimg.git /src', 'COPY vendor-src/zimg /src')
dockerfile.write_text(text)
print('Source ready. Run: cd ' + str(context) + ' && make prd && make prd-mt')
