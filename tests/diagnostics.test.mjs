import test from 'node:test';
import assert from 'node:assert/strict';
import { appendDiagnosticLog, buildDiagnosticReport } from '../dist/diagnostics.js';

test('report preserves underlying probe error, return code, settings and browser context', () => {
  const cause = new Error('Invalid data found when processing input');
  cause.exitCode = 1;
  const error = new Error('動画の情報を読み込めませんでした。', { cause });
  const report = buildDiagnosticReport({
    error, stage: '入力動画の確認',
    input: { extension: 'webm', size: 123456, type: 'video/webm', name: 'private-name.webm' },
    info: { codec: 'vp9', width: 1920, height: 1080 }, format: 'mp4', quality: 'medium',
    engineConfig: { mode: 'single', threads: 1 },
    environment: { userAgent: 'Chrome example', crossOriginIsolated: true },
    logs: ['EBML header parsing failed'], command: ['ffprobe', '-v', 'error', '/input/source.webm'],
  });
  for (const expected of ['動画の情報を読み込めませんでした。', 'Invalid data found when processing input', 'exitCode: 1', 'EBML header parsing failed', 'vp9', '1920', 'mp4', 'medium', 'Chrome example', 'ffprobe', '/input/source.webm', '123456', 'diagnostics-v1']) {
    assert.ok(report.includes(expected), expected);
  }
  assert.match(report, /記録日時: \d{4}-\d\d-\d\dT/);
  assert.ok(!report.includes('private-name.webm'));
  const firstRows = report.split('\n').slice(0, 10).join('\n');
  assert.match(firstRows, /失敗した処理: 入力動画の確認/);
  assert.match(firstRows, /Invalid data found when processing input/);
  assert.ok(report.indexOf('Invalid data found when processing input') < report.indexOf('記録日時:'));
});

test('report retains both parallel failure and final single-thread failure', () => {
  const report = buildDiagnosticReport({
    error: 'single encoder failed', stage: '変換', engineConfig: { mode: 'single', threads: 1 }, logs: ['single log'],
    attempts: [{ error: new Error('parallel allocation failed'), stage: '変換', engineConfig: { mode: 'multi', threads: 4 }, logs: ['parallel log'], command: ['-threads', '4'] }],
  });
  for (const expected of ['single encoder failed', 'single log', 'parallel allocation failed', 'parallel log', 'mode: multi', 'threads: 4', 'mode: single', 'threads: 1', '再試行前のエラー']) {
    assert.ok(report.includes(expected), expected);
  }
});

test('worker strings and plain-object errors remain diagnosable, including cycles', () => {
  assert.match(buildDiagnosticReport({ error: 'RuntimeError: memory access out of bounds' }), /RuntimeError: memory access out of bounds/);
  const error = { name: 'WorkerError', message: 'Decoder unavailable', code: 42 };
  error.cause = error;
  const report = buildDiagnosticReport({ error });
  assert.match(report, /WorkerError/);
  assert.match(report, /Decoder unavailable/);
  assert.match(report, /code: 42/);
  assert.match(report, /循環参照/);
});

test('logs retain recent failures while bounding memory and report length', () => {
  const logs = [];
  for (let i = 0; i < 100; i++) appendDiagnosticLog(logs, `log ${i} ${'x'.repeat(3000)}`);
  assert.equal(logs.length, 80);
  assert.ok(logs[0].startsWith('log 20 '));
  assert.ok(logs.at(-1).startsWith('log 99 '));
  assert.ok(logs.every(line => line.length <= 2000 && line.endsWith('[省略]')));
  const report = buildDiagnosticReport({ error: 'E'.repeat(100000), logs: Array(100).fill('x'.repeat(10000)) });
  assert.ok(report.length < 175000);
  assert.match(report, /省略/);
});
