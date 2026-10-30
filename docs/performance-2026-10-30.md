# Maitake並列変換のローカル比較（2026-10-30）

## 結果

同じ3分のWebMを、既存の「中」品質でMP4に変換した。各2回の平均で、変換処理は **164.8秒 → 47.8秒、3.45倍、71.0%短縮**。Windowsでの計測値ではない。

| 方式 | 1回目 | 2回目 | 平均 | 出力サイズ |
| --- | ---: | ---: | ---: | ---: |
| 公開版の単一スレッド | 163.02秒 | 166.62秒 | 164.82秒 | 25,521,372 bytes |
| 並列版・4スレッド | 46.92秒 | 48.61秒 | 47.77秒 | 25,528,662 bytes |

上の時間は`ffmpeg.exec()`。エンジン読み込み、入力解析、出力確認を含めたローカル処理全体の平均は164.93秒と47.94秒。初回のインターネット経由のエンジンダウンロードとService Worker登録は含まない。実行順は単一→並列→並列→単一とし、同時変換は行っていない。

スレッド選定用の15秒区間では、単一13.71秒、2スレッド5.68秒、4スレッド4.71秒だった。

## 条件と再現方法

- Apple M3（8論理CPU）、24GiB RAM、macOS（Darwin27.0.0）、arm64。
- インストール済みGoogle Chrome156.0.8078.74をPlaywrightからheadless起動。ユーザーの通常プロファイルは使用しない。
- 入力は1280×720、60fps、VP9/Opus、180.021秒、40,102,120bytes。
- 入力SHA-256: `6172d7f73033a0a4d7751bf0db5c9c7a9e6f8a642b185fce33d396b60416c5a5`。
- 出力は既存の「中」品質: H.264 `veryfast` / CRF23、yuv420p、1280×720、30fps、AAC128kbps、48kHz、ステレオ。
- 旧版の基準は`d3f27ae7431b4530f44399b96cada75a45844d04`。ベンチマーク内で旧版の引数と新しい1スレッド設定が完全一致することを検証。
- `@ffmpeg/core` / `@ffmpeg/core-mt`はいずれも0.12.10。入力はどちらもWORKERFSでマウント。
- 詳しい実行方法は[ベンチマーク手順](benchmark.md)。

元動画は[Big Buck BunnyのWikimedia Commons掲載版](https://commons.wikimedia.org/wiki/File:Big_Buck_Bunny_4K.webm)。[720p VP9 WebM](https://upload.wikimedia.org/wikipedia/commons/transcoded/c/c0/Big_Buck_Bunny_4K.webm/Big_Buck_Bunny_4K.webm.720p.vp9.webm)をダウンロードし、先頭180秒を`ffmpeg -t 180 -map 0:v:0 -map 0:a:0 -c copy`で切り出した。入力を再圧縮したり、短い映像を繰り返したりしていない。

Attribution: (c) copyright Blender Foundation | www.bigbuckbunny.org — [CC BY3.0](https://creativecommons.org/licenses/by/3.0/)。変更は検証用区間への切り出しと出力MP4への変換。比較用動画はアプリやリポジトリに同梱しない。

## 出力と機能の検証

- 4回すべてのMP4をダウンロードし、ネイティブFFmpegで全編デコード成功。
- 両方式とも映像5,400フレーム・180.000秒、音声180.021秒・48kHz・2ch。
- AACの圧縮パケット列のSHA-256が一致: `aa63243e4cb17a9fbdaa07260180a9097fa022ee3d665bd7e4adcb5cb034fe9b`。
- 旧版と並列版の出力映像同士のSSIMは0.996439。圧縮処理の並列化で映像のバイト列は変わるが、品質プリセットは変更していない。この数値は元動画に対する画質スコアではない。
- 設定・URL・スレッド上限の単体テスト11件に成功。
- `/Maitake/`配下の実Chromeで10ケースに成功: 4形式、読み込み失敗と変換失敗の従来版への切り替え、非分離環境、準備中/変換中のキャンセル、実際の3分動画の変換中断と再試行。
- Service Workerの初回・再訪と、登録が遅れて画面操作が有効になった場合を検証。スコープは`/Maitake/`のみ。遅い登録によって画面が再読み込みされないことを確認。

## メモリの参考測定

速度比較とは別に、先頭15秒の同じWebMでChrome配下のプロセスのRSSを1秒間隔で合計した。観測最大値は単一スレッド1,353,105,408bytes（約1.35GB）、4スレッド1,730,019,328bytes（約1.73GB）。それぞれ15回、6回のサンプルを取得した。

これはブラウザ全体のRSS合計で、共有ページの重複計上を含み得る。1秒未満のピークは捕捉できず、専有物理メモリ量や3分動画のピーク使用量を表すものではない。並列化でメモリ消費が増えることを確認する参考値として扱う。証跡は`/private/tmp/maitake-benchmark-results/memory-{single-1,multi-4}/result.json`。

## 実装範囲と限界

対応環境では各コーデック・フィルターを2〜4スレッドで実行する。非対応環境、2GiB以下のメモリと判定された端末、並列エンジンの準備や変換に失敗した場合は従来版を使用する。品質、出力形式、入力300MB・出力600MBの制限、端末内処理は維持した。

上流の並列エンジン自体は1GiBの共有WASMメモリと32個の待機workerを準備する。2〜4スレッドという設定は、この固定割り当てを小さくする設定ではない。

この結果はApple M3上のChromeと今回の動画に対するもの。ユーザーのWindows端末や実際の入力動画での速度は未測定。30分かかった動画が同じ割合で短縮するとは断定しない。GitHubへのpush・公開は行っていない。

## ローカル証跡

- 集計: `/private/tmp/maitake-benchmark-results/summary.json`
- 個別結果・MP4: `/private/tmp/maitake-benchmark-results/full-{single-1,multi-4}-{a,b}/`
- 入力: `/private/tmp/maitake-benchmark-inputs/big-buck-bunny-180s.webm`
- UI検証: `evidence/smoke-subpath/results.json`
- 起動検証: `evidence/bootstrap/results.json`
