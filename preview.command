#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")"
if command -v node >/dev/null 2>&1; then
  maitake_node="$(command -v node)"
elif [ -x "$HOME/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node" ]; then
  maitake_node="$HOME/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node"
else
  echo "Node.js 22以降をインストールしてから実行してください。"
  exit 1
fi
if [ ! -f dist/vendor/core/ffmpeg-core.wasm ]; then
  echo "最初に pnpm install と pnpm build を実行してください。"
  exit 1
fi
echo "Maitake を起動します。表示されたURLをChromeで開いてください。"
echo "終了するには、このウィンドウで Control + C を押してください。"
exec "$maitake_node" scripts/serve.mjs
