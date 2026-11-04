const MAX_LOGS = 80;
const MAX_LOG_LENGTH = 2000;
const TRUNCATED = '… [省略]';

function boundedText(value, limit = 8000) {
  const text = String(value);
  return text.length > limit ? text.slice(0, limit - TRUNCATED.length) + TRUNCATED : text;
}

// Errors may cross the worker boundary as strings or plain objects. Keep both
// those values and Error.cause, which JSON.stringify normally omits.
function printable(value, seen = new Set(), depth = 0) {
  if (value === undefined) return '不明';
  if (value === null || typeof value !== 'object') return boundedText(value);
  if (seen.has(value)) return '[循環参照]';
  if (depth >= 6) return '[深い階層を省略]';
  seen.add(value);
  let result;
  if (value instanceof Error) {
    const summary = `${value.name}: ${value.message}`;
    const lines = [boundedText(summary)];
    for (const key of ['code', 'exitCode']) {
      if (value[key] !== undefined) lines.push(`${key}: ${printable(value[key], seen, depth + 1)}`);
    }
    if (value.cause !== undefined) lines.push(`原因: ${printable(value.cause, seen, depth + 1)}`);
    // Put the original failure before stack frames so it is visible immediately
    // in the report's compact textarea, including when a friendly error wraps it.
    const stack = value.stack?.startsWith(summary + '\n') ? value.stack.slice(summary.length + 1) : value.stack;
    if (stack && stack !== summary) lines.push(boundedText(stack));
    result = lines.join('\n');
  } else {
    const entries = Object.entries(value).slice(0, 40);
    result = entries.map(([key, item]) => `${boundedText(key, 100)}: ${printable(item, seen, depth + 1)}`).join('\n');
    if (Object.keys(value).length > entries.length) result += '\n[残りの項目を省略]';
    if (!result) result = Array.isArray(value) ? '[]' : '{}';
  }
  seen.delete(value);
  return boundedText(result, 16000);
}

export function appendDiagnosticLog(logs, message) {
  logs.push(boundedText(message, MAX_LOG_LENGTH));
  if (logs.length > MAX_LOGS) logs.splice(0, logs.length - MAX_LOGS);
}

function commandText(command) {
  if (!command) return 'なし';
  return boundedText(Array.isArray(command) ? command.map(arg => JSON.stringify(String(arg))).join(' ') : command);
}

function attemptText({ error, stage, engineConfig, logs = [], command } = {}) {
  const boundedLogs = [];
  for (const message of logs.slice(-MAX_LOGS)) appendDiagnosticLog(boundedLogs, message);
  return [
    `失敗した処理: ${printable(stage)}`,
    '', 'エラー:', printable(error),
    '', `エンジン: ${printable(engineConfig)}`,
    '', '実行コマンド:', commandText(command),
    '', `FFmpegログ（末尾${MAX_LOGS}件まで）:`, boundedLogs.join('\n') || 'ログなし',
  ].join('\n');
}

export function buildDiagnosticReport({ error, stage, input, info, format, quality, engineConfig, environment, logs = [], attempts = [], command, version = 'v0.1.0' } = {}) {
  // Only technical input facts are included; the original filename is not needed.
  const inputFacts = input ? { extension: input.extension, size: input.size, type: input.type } : undefined;
  return [
    'Maitake エラー詳細',
    attemptText({ error, stage, engineConfig, logs, command }),
    '', '--- 変換設定・環境 ---',
    `記録日時: ${new Date().toISOString()}`,
    `アプリ: ${boundedText(version, 200)} / diagnostics-v1`,
    '', '入力ファイル:', printable(inputFacts),
    '', '動画情報:', printable(info),
    '', `出力形式: ${printable(format)}`, `品質: ${printable(quality)}`,
    '', 'ブラウザ環境:', printable(environment),
    ...attempts.slice(-3).map((attempt, index) => `\n--- 再試行前のエラー ${index + 1} ---\n${attemptText(attempt)}`),
  ].join('\n');
}
