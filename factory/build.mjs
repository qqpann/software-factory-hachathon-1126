import fs from 'node:fs';
import path from 'node:path';
import { runClaude } from './lib/claude.mjs';
import { FACTORY_DIR, ROOT, fill, prompt, readText } from './lib/util.mjs';

/** Turn the previous round's evaluation into concrete instructions for the builder. */
export function feedbackText(prev) {
  if (!prev) return '';
  const lines = ['## 前の周回の評価（これを直してください）'];
  const failed = (prev.gate?.checks || []).filter((c) => !c.pass && c.required);
  if (failed.length) {
    lines.push('### 機械判定で落ちた項目（最優先）');
    for (const c of failed) lines.push(`- ${c.id}: ${c.detail}`);
  }
  if (prev.gate?.errors?.length) {
    lines.push('### 実行時エラー');
    for (const e of prev.gate.errors.slice(0, 8)) lines.push(`- ${e}`);
  }
  const r = prev.playtest?.review;
  if (r) {
    lines.push(`### 試遊AIの評価（合計 ${prev.playtest.total}／1.0、結果: ${r.reached}）`);
    lines.push(`- 点数: ${Object.entries(r.scores || {}).map(([k, v]) => `${k}=${v}`).join(', ')}`);
    if (r.summary) lines.push(`- 総評: ${r.summary}`);
    for (const b of r.bugs || []) lines.push(`- 不具合: ${b.what}${b.evidence ? `（証拠: ${b.evidence}）` : ''}`);
    for (const f of r.fixes || []) lines.push(`- 修正依頼: ${f}`);
  }
  if (prev.roundDir) {
    lines.push(`\n前の周回のスクリーンショットは ${prev.roundDir} にあります。必要なら Read で見てください。`);
  }
  return lines.join('\n');
}

export async function runBuilder({ workDir, brief, round, prev, mock = false }) {
  const htmlPath = path.join(workDir, 'index.html');
  if (mock) {
    // Offline stand-in: round 1 ships a broken game, later rounds ship the fixed sample.
    const fixture = round === 1 ? 'broken.html' : 'sample-dodge.html';
    fs.copyFileSync(path.join(FACTORY_DIR, 'fixtures', fixture), htmlPath);
    return { ok: true, costUsd: 0, summary: `（モック）${fixture} を配置` };
  }
  const exists = fs.existsSync(htmlPath);
  const task = exists
    ? '既存の `index.html` を読み、下の評価を踏まえて改善してください。'
    : '`index.html` を新しく作ってください。最初から遊べる完成品を目指してください。';
  const text = fill(prompt('builder'), {
    brief,
    contract: readText(path.join(ROOT, 'CONTRACT.md')),
    quality: readText(path.join(ROOT, 'QUALITY.md'), '（なし）'),
    lessons: readText(path.join(ROOT, 'lessons.md'), '（なし）'),
    round,
    task,
    feedback: feedbackText(prev),
  });
  const res = await runClaude({
    prompt: text,
    cwd: workDir,
    allowedTools: ['Read', 'Write', 'Edit'],
    addDirs: prev?.roundDir ? [prev.roundDir] : [],
  });
  return { ok: res.ok && fs.existsSync(htmlPath), costUsd: res.costUsd, summary: res.text.slice(-600), error: res.error };
}
