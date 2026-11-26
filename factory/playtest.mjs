import path from 'node:path';
import { startPlayServer } from './play-server.mjs';
import { runClaude } from './lib/claude.mjs';
import { FACTORY_DIR, ROOT, extractJson, fill, prompt, readText, writeJson } from './lib/util.mjs';

export const SCORE_KEYS = ['clarity', 'controls', 'goal', 'fairness', 'fun', 'brief_fit', 'visuals', 'stability', 'depth'];

export function scorePlaytest(review) {
  if (!review?.scores) return 0;
  const vals = SCORE_KEYS.map((k) => Math.min(5, Math.max(1, Number(review.scores[k]) || 1)));
  // 1..5 → 0..1
  return Math.round((vals.reduce((a, b) => a + b, 0) / vals.length - 1) * 25) / 100;
}

/**
 * A separate Claude plays the game through factory/play.mjs and reviews it
 * with evidence. Returns { review, total, costUsd, steps }.
 */
export async function runPlaytest({ browser, htmlPath, roundDir, brief, maxActions = 60, mock = false }) {
  const server = await startPlayServer(browser, htmlPath, roundDir, { maxActions });
  const playScript = path.join(FACTORY_DIR, 'play.mjs');
  let review = null;
  let costUsd = 0;
  let error = null;
  try {
    if (mock) {
      review = await mockPlay(server.url);
    } else {
      const res = await runClaude({
        prompt: fill(prompt('playtester'), { brief, quality: readText(path.join(ROOT, 'QUALITY.md'), '（なし）'), play: playScript, maxActions }),
        cwd: roundDir,
        allowedTools: [`Bash(node ${playScript}:*)`, 'Read'],
        permissionMode: 'default',
        env: { FACTORY_PLAY_URL: server.url },
      });
      costUsd = res.costUsd;
      review = extractJson(res.text);
      if (!res.ok) error = res.error;
      if (!review) error = (error ? error + '\n' : '') + '試遊結果のJSONを読み取れませんでした';
    }
  } finally {
    await server.close();
  }
  const result = {
    total: scorePlaytest(review),
    review,
    steps: server.steps,
    runtime_errors: [...new Set(server.errors)].slice(0, 10),
    costUsd,
    error,
  };
  writeJson(path.join(roundDir, 'playtest.json'), result);
  return result;
}

/** Offline stand-in for the AI player: exercises the server, returns a fixed review. */
async function mockPlay(url) {
  const call = (cmd, ...args) => fetch(url, { method: 'POST', body: JSON.stringify({ cmd, args }) }).then((r) => r.json());
  await call('look');
  await call('press', 'Space');
  for (let i = 0; i < 6; i++) await call('hold', i % 2 ? 'ArrowLeft' : 'ArrowRight', 400);
  const last = await call('look');
  return {
    scores: { clarity: 4, controls: 4, goal: 4, fairness: 3, fun: 3, brief_fit: 4, visuals: 3, stability: 4, depth: 3 },
    reached: last.game?.state === 'won' ? 'won' : last.game?.state === 'lost' ? 'lost' : 'neither',
    bugs: [],
    fixes: ['（モック試遊）'],
    summary: 'モック試遊です。AIによる評価ではありません。',
  };
}
