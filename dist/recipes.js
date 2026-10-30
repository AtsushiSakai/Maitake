export const MAX_INPUT_BYTES = 300_000_000;
export const MAX_OUTPUT_BYTES = 600_000_000;
export const FORMATS = {
  mp4: { title: 'MP4', mime: 'video/mp4', codec: 'H.264 / AAC', note: 'Windows・Mac・iPhone向けのおすすめ形式。Ubuntuでは再生環境によって追加コーデックが必要です。' },
  mov: { title: 'MOV', mime: 'video/quicktime', codec: 'H.264 / AAC', note: 'Mac・iPhoneや、MOVを指定する編集ソフト向け。互換性を優先したH.264で保存します。' },
  avi: { title: 'AVI', mime: 'video/x-msvideo', codec: 'Motion JPEG / PCM', note: 'AVIが必要なソフト向け。容量が大きくなりやすく、出力上限は600MBです。ブラウザ内プレビューは非対応です。' },
  webm: { title: 'WebM', mime: 'video/webm', codec: 'VP8 / Vorbis', note: 'Ubuntu・ブラウザ再生向けの候補。再生環境によって対応が異なります。高画質での変換には時間がかかります。' },
};
export const QUALITIES = {
  high: { title: '最高', crf: 18, vp8: 10, jpeg: 2, audio: '192k' },
  medium: { title: '中', crf: 23, vp8: 20, jpeg: 5, audio: '128k', long: 1920, short: 1080 },
  light: { title: '軽量', crf: 28, vp8: 32, jpeg: 9, audio: '96k', long: 1280, short: 720 },
};
export function validateFile(file) {
  if (!file || file.size === 0) throw new Error('空のファイルです。動画ファイルを選び直してください。');
  if (file.size > MAX_INPUT_BYTES) throw new Error('入力できる動画は300MBまでです。小さいファイルを選んでください。');
}
export function extension(name) { return /\.([a-z0-9]{1,10})$/i.exec(name)?.[1].toLowerCase() || 'bin'; }
export function outputName(name, format, quality) {
  const stem = name.replace(/\.[^.]+$/, '').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_') || 'video';
  return `${stem}_${quality}.${format}`;
}
export function frameRate(value) {
  const [n, d = 1] = String(value || '').split('/').map(Number);
  return d && Number.isFinite(n / d) ? n / d : 0;
}
export function summarizeProbe(probe) {
  const video = probe.streams?.find(s => s.codec_type === 'video' && !s.disposition?.attached_pic);
  if (!video || !(video.width > 0) || !(video.height > 0)) throw new Error('読み込める映像が見つかりません。対応していない形式、または壊れたファイルの可能性があります。');
  const audio = probe.streams.find(s => s.codec_type === 'audio');
  const rotation = Number(video.side_data_list?.find(s => 'rotation' in s)?.rotation || video.tags?.rotate || 0);
  const rotated = Math.abs(rotation) % 180 === 90;
  const duration = Number(probe.format?.duration || video.duration || 0);
  return { videoIndex: video.index, width: rotated ? video.height : video.width, height: rotated ? video.width : video.height, fps: frameRate(video.avg_frame_rate || video.r_frame_rate), duration: Number.isFinite(duration) ? duration : 0, codec: video.codec_name, audio: audio?.codec_name, hdr: ['smpte2084', 'arib-std-b67'].includes(video.color_transfer) };
}
export function buildArgs({ input, format, quality, info, threads = 1 }) {
  const q = QUALITIES[quality];
  if (!q || !FORMATS[format]) throw new Error('出力設定が正しくありません。');
  if (!Number.isInteger(threads) || threads < 1 || threads > 4) throw new Error('処理スレッド数が正しくありません。');
  // Normalize anamorphic pixels and even dimensions before scaling. FFmpeg autorotates first.
  const filters = ['scale=trunc(iw*sar/2)*2:trunc(ih/2)*2', 'setsar=1'];
  if (q.long) {
    filters.push(`scale=w='if(gte(iw,ih),min(iw,${q.long}),min(iw,${q.short}))':h='if(gte(iw,ih),min(ih,${q.short}),min(ih,${q.long}))':force_original_aspect_ratio=decrease:force_divisible_by=2`);
    if (info.fps > 30 || !info.fps) filters.push('fps=30');
  }
  const args = ['-hide_banner', '-loglevel', 'info', '-threads', String(threads), '-i', input, '-map', `0:${info.videoIndex}`, '-map', '0:a:0?', '-map_metadata', '-1', '-map_chapters', '-1', '-vf', filters.join(','), '-ac', '2', '-ar', '48000'];
  if (threads > 1) args.push('-filter_threads', String(threads));
  if (format === 'mp4' || format === 'mov') {
    args.push('-c:v', 'libx264', '-preset', 'veryfast', '-crf', String(q.crf), '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', q.audio, '-movflags', '+faststart');
  } else if (format === 'avi') {
    // The core's optimal-Huffman MJPEG path traps after the first frame.
    // Standard Huffman tables work across complete video sequences in 0.12.10.
    args.push('-c:v', 'mjpeg', '-huffman', 'default', '-q:v', String(q.jpeg), '-pix_fmt', 'yuvj420p', '-c:a', 'pcm_s16le');
  } else {
    const pixels = Math.min((info.width || 1920) * (info.height || 1080), (q.long || Infinity) * (q.short || Infinity));
    const bitrate = Math.max(250_000, Math.round(pixels * Math.min(info.fps || 30, q.long ? 30 : 60) * { high: 0.2, medium: 0.12, light: 0.08 }[quality]));
    args.push('-c:v', 'libvpx', '-deadline', 'good', '-cpu-used', '4', '-b:v', String(bitrate), '-crf', String(q.vp8), '-pix_fmt', 'yuv420p', '-c:a', 'libvorbis', '-q:a', String({ high: 5, medium: 3, light: 1 }[quality]));
  }
  args.push('-threads', String(threads), '-fs', String(MAX_OUTPUT_BYTES), `output.${format}`);
  return args;
}
