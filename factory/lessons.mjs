import fs from 'node:fs';
import path from 'node:path';
import { runClaude } from './lib/claude.mjs';
import { ROOT, fill, prompt, readText } from './lib/util.mjs';

/** Summarise every round in a few lines each, for the lessons step. */
export function historyText(rounds) {
  return rounds
    .map((r) => {
      const failed = (r.gate?.checks || []).filter((c) => !c.pass && c.required).map((c) => `${c.id}(${c.detail})`);
      const rv = r.playtest?.review;
      return [
        `### ${r.round}周目: score=${r.score}`,
        failed.length ? `- 機械判定NG: ${failed.join('; ')}` : '- 機械判定: すべて通過',
        rv ? `- 試遊: ${rv.reached} / ${rv.summary || ''}` : '',
        ...(rv?.bugs || []).map((b) => `- 不具合: ${b.what}`),
        ...(rv?.fixes || []).map((f) => `- 修正依頼: ${f}`),
      ]
        .filter(Boolean)
        .join('\n');
    })
    .join('\n\n');
}

/**
 * Outer loop: distil general lessons from this run into lessons.md so the
 * next game starts better. Keeps a backup of the previous file in the run dir.
 */
export async function updateLessons({ rounds, runDir, mock = false }) {
  const lessonsPath = path.join(ROOT, 'lessons.md');
  const current = readText(lessonsPath);
  fs.writeFileSync(path.join(runDir, 'lessons.before.md'), current);
  if (mock) return { updated: false, costUsd: 0, note: 'モックのため教訓は更新しません' };

  const res = await runClaude({
    prompt: fill(prompt('lessons'), { history: historyText(rounds), lessons: current }),
    cwd: runDir,
    allowedTools: [],
    permissionMode: 'default',
  });
  const m = res.text.match(/```(?:markdown|md)?\s*([\s\S]*?)```/);
  const next = (m ? m[1] : '').trim();
  if (!res.ok || !next.startsWith('# 工場の教訓')) {
    return { updated: false, costUsd: res.costUsd, note: '教訓の更新結果を読み取れませんでした', error: res.error };
  }
  fs.writeFileSync(lessonsPath, next + '\n');
  fs.writeFileSync(path.join(runDir, 'lessons.after.md'), next + '\n');
  return { updated: true, costUsd: res.costUsd };
}
