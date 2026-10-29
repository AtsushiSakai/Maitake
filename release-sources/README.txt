Maitake 0.1.0 — corresponding source and build instructions

Application source: https://github.com/AtsushiSakai/Maitake
Source downloads: https://atsushisakai.github.io/Maitake/sources/

The distributed @ffmpeg/core 0.12.10 binary is unmodified. The upstream
release commit is 71aa99d37c02a7b4c435275ca9ef50e612f6efa1 (tag v12.15),
which also contains @ffmpeg/ffmpeg 0.12.15. Its Dockerfile, Makefile,
build scripts, C bindings, JavaScript wrapper, and third-party sources
are supplied here. manifest.json pins every archive to a commit and
SHA-256 digest. Original copyright notices and license files are retained
inside the source archives. See ../licenses/FFmpeg-GPLv2.txt and
../third-party-notices.txt for the main license notices.

Rebuild the single-thread production core (Linux / Docker Buildx):

1. Download prepare-build.py to an empty directory.
2. Run with Python 3.12 or newer:
     python3 prepare-build.py
   It downloads the manifest and archives from this site's sources/
   directory, verifies SHA-256 hashes, extracts the source, and creates a
   Docker build context using the supplied dependency source trees.
3. Install Docker with Buildx and GNU Make. Run:
     cd maitake-core-source/build-context
     make prd
4. ESM output is in packages/core/dist/esm/ffmpeg-core.js and
   packages/core/dist/esm/ffmpeg-core.wasm. UMD output is also generated.

The build uses Emscripten SDK 3.1.40, FFmpeg n5.1.4, and the library
versions in manifest.json. Production flags are -O3 -msimd128 and
FFMPEG_ST=yes; the full feature configuration is in Dockerfile.upstream
and the included build/ scripts. The base Docker image, Ubuntu packages,
and Emscripten SDL build tooling require network access at build time.
The original upstream Dockerfile is also included. The preparation script
only changes dependency fetching to use the supplied source copies.
It does not modify the codec source or feature configuration.

The upstream release binary is supplied through the pinned npm package;
Maitake does not claim that a local rebuild is bit-for-bit identical.
Rebuilding the core is optional for building the web app itself:
  pnpm install --frozen-lockfile
  pnpm build:release

License scope:
- @ffmpeg/ffmpeg wrapper: MIT.
- @ffmpeg/core: GPL-2.0-or-later, including GPL-enabled codecs.
- Individual dependencies retain their own licenses and notices, as
  included in their source archives. The wrapper's MIT license does not
  replace any of these licenses.
- Emscripten/emsdk and SDL source are supplied for the runtime/build
  context; their original licenses remain in their archives.
