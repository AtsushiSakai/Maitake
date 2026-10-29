# Maitake — local video converter

動画をアップロードせず、ブラウザ内で変換するWebアプリ。日本語UI、PC版Chromeを主対象としています。

**[Maitakeを開く](https://atsushisakai.github.io/Maitake/)**

選択した動画・音声・ファイル名はサーバーへ送信しません。変換プログラムも同じサイトから配信し、外部CDN・広告・アクセス解析は使用しません。ページの配信元であるGitHub Pagesでは通常のアクセス情報が記録される場合があります。

## Run locally

Node.js 22以降とpnpmを使います。

```sh
pnpm install --frozen-lockfile
pnpm build
pnpm dev
```

表示されたローカルURLをChromeで開いてください。`dist/index.html`を直接開くfile://方式ではWeb Workerが動作しません。

## Functionality

- 入力上限300,000,000バイト。拡張子を初期表示に使い、実際の映像・音声はffprobeで確認。
- 入力はWORKERFSのローカルFileとしてマウント。動画をサーバーへ送らず、全入力のWASMメモリへのコピーも避ける。
- 出力: MP4 / MOV (H.264 + AAC)、AVI (MJPEG + PCM)、WebM (VP8 + Vorbis)。
- 品質: 最高 (元の解像度・fps)、中 (最大1080p・30fps)、軽量 (最大720p・30fps)。縦向き、回転情報、音声なしに対応。
- キャンセルはWorkerを終了し、次回変換時に再初期化。完成時にもWorkerメモリを解放。
- 変換後に再解析し、空ファイル・出力上限到達・明らかに短い結果を保存可能な完成品として表示しない。
- 出力600MB上限。大きくなりやすいAVIには特に注意。
- 初回の変換エンジンは約32MB。同一サイトに同梱し、外部CDN・広告・解析SDKは不使用。
- デモ動画は自作の短いアニメーション。`scripts/make-sample.py`で生成 (開発時のみPillowとFFmpegが必要)。

## Compatibility and limits

MP4のH.264 8-bit yuv420p / AACをWindows 11、Mac、iPhoneの基本ターゲットとし、WebMもUbuntu向けに提供します。OS名だけでの全環境互換性は保証しません。標準プレーヤーの実機再生確認は別途必要です。

このバージョンはSDR動画が対象です。HDR動画は色を誤って変換しないよう、説明を表示して停止します。動画1トラックと最初の音声1トラックを出力し、字幕、追加音声、チャプター、元のメタデータは保持しません。最高品質も無劣化ではありません。

300MB以内でも、長尺・高解像度では時間やメモリを要します。タブを閉じると処理は終了します。途中再開と一括変換は対象外です。ファイルと結果をIndexedDB等に保存しません。

## Validation

```sh
pnpm test
```

確認範囲は[検証記録](docs/validation.md)に記載しています。テスト用の大容量入力と開発用スクリーンショットは公開対象に含めません。

## GitHub Pages

`pnpm build`の後、`dist/`全体を静的サイトとして配信します。相対パスなので`https://owner.github.io/repository/`配下に対応します。単一スレッド版でCOOP/COEPヘッダーは不要です。変換APIはありません。

`main`へのPushで`.github/workflows/pages.yml`がテスト、公開用ビルド、Pagesへの配信を行います。`dist/vendor/`と`dist/sources/`は生成物のためGit管理から除外し、CIでチェックサムを検証してPagesアーティファクトに含めます。

公開用ビルドは`pnpm build:release`です。通常の変換で読み込むエンジンは約32MBです。ライセンス上の対応ソースは別のダウンロードページから提供し、動画変換時には読み込みません。

## Third-party software

Versions are locked in `pnpm-lock.yaml`; see `dist/third-party-notices.txt` and `dist/licenses/`. FFmpeg and codec components retain their own licenses. The corresponding source archives, original notices, pinned hashes, and build instructions are served at [sources/](https://atsushisakai.github.io/Maitake/sources/). A wrapper's MIT license does not replace the core's GPL-2.0-or-later license or its dependencies' licenses.
