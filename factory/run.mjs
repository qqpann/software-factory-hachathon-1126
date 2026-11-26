#!/usr/bin/env node
// ブラウザゲーム工場のメインループ。
//   node factory/run.mjs briefs/dodge.md [--max-rounds 6] [--threshold 0.75] [--patience 3]
//                                        [--max-cost 10] [--actions 60] [--mock]
import fs from 'node:fs';
import path from 'node:path';
import { runBuilder } from './build.mjs';
import { runGate } from './gate.mjs';
import { runPlaytest } from './playtest.mjs';
import { updateLessons } from './lessons.mjs';
import { writeReport } from './report.mjs';
import { launchBrowser } from './lib/browser.mjs';
import { minClearMinutes, volumeCheck } from './volume.mjs';
import { ROOT, ensureDir, log, parseArgs, readText, rel, slugOf, timestamp, writeJson } from './lib/util.mjs';

const args = parseArgs(process.argv.slice(2));
const briefPath = args._[0];
if (!briefPath || !fs.existsSync(briefPath)) {
  console.error('使い方: node factory/run.mjs briefs/xxx.md [--max-rounds 6] [--threshold 0.75] [--patience 3] [--max-cost 10] [--mock]');
  process.exit(2);
}

const opts = {
  maxRounds: Number(args['max-rounds'] ?? 6),
  threshold: Number(args.threshold ?? 0.75),
  patience: Number(args.patience ?? 3),
  maxCost: Number(args['max-cost'] ?? 10),
  actions: Number(args.actions ?? 60),
  mock: !!args.mock,
};
const minMinutes = args['min-minutes'] ? Number(args['min-minutes']) : minClearMinutes(readText(briefPath));

const slug = slugOf(briefPath);
const brief = readText(briefPath);
const rounds = [];
let best = null;
let sinceImprove = 0;
let cost = 0;
let stopReason = 'max_rounds';

/** 0..1. Gate contributes 30%, the AI playtest 70% (scaled down when the game is cleared too fast). */
function roundScore(gate, playtest, volume) {
  const g = gate.total ? gate.passed / gate.total : 0;
  return Math.round((g * 0.3 + (playtest ? playtest.total * 0.7 * (volume?.factor ?? 1) : 0)) * 100) / 100;
}

let browser;
try {
  browser = await launchBrowser();
} catch (e) {
  console.error(e.message);
  process.exit(2);
}

const runDir = ensureDir(path.join(ROOT, 'runs', slug, timestamp()));
const workDir = ensureDir(path.join(runDir, 'work'));
log(`工場を起動: ${slug}（最大${opts.maxRounds}周、合格ライン ${opts.threshold}${minMinutes ? `、クリアまで最低${minMinutes}分` : ''}${opts.mock ? '、モック' : ''}）`);
log(`記録: ${rel(runDir)}`);

try {
  for (let round = 1; round <= opts.maxRounds; round++) {
    const roundDir = ensureDir(path.join(runDir, `round-${round}`));
    const prev = rounds.at(-1);

    log(`── ${round}周目: 作る`);
    const build = await runBuilder({ workDir, brief, round, prev, mock: opts.mock });
    cost += build.costUsd;
    const html = path.join(workDir, 'index.html');
    if (fs.existsSync(html)) fs.copyFileSync(html, path.join(roundDir, 'index.html'));
    if (!build.ok) log(`作る係がエラー: ${(build.error || '').split('\n')[0]}`);

    log(`── ${round}周目: 機械判定`);
    const gate = await runGate(path.join(roundDir, 'index.html'), roundDir, { browser });
    log(`機械判定 ${gate.pass ? 'PASS' : 'FAIL'} (${gate.passed}/${gate.total})`);

    let playtest = null;
    if (gate.pass) {
      log(`── ${round}周目: AI試遊`);
      playtest = await runPlaytest({ browser, htmlPath: path.join(roundDir, 'index.html'), roundDir, brief, maxActions: opts.actions, mock: opts.mock });
      cost += playtest.costUsd;
      log(`試遊 ${playtest.total}（${playtest.review?.reached ?? '?'}、${playtest.steps}手）${playtest.error ? ' ⚠ ' + playtest.error.split('\n')[0] : ''}`);
    }

    const volume = playtest ? volumeCheck(playtest, minMinutes) : null;
    if (volume?.pass !== undefined && volume?.pass !== null) log(volume.detail);
    const score = roundScore(gate, playtest, volume);
    const rec = { round, roundDir, score, build: { ok: build.ok, summary: build.summary, costUsd: build.costUsd }, gate, playtest, volume };
    rounds.push(rec);
    writeJson(path.join(runDir, 'summary.json'), { slug, brief: rel(briefPath), opts, cost, rounds: rounds.map(strip) });

    if (!best || score > best.score) {
      best = rec;
      sinceImprove = 0;
    } else sinceImprove++;
    log(`${round}周目のスコア ${score}（ベスト ${best.score}、累計 $${cost.toFixed(2)}）`);

    if (gate.pass && playtest && playtest.total >= opts.threshold && volume?.pass !== false) {
      stopReason = 'completed';
      break;
    }
    if (sinceImprove >= opts.patience) {
      stopReason = 'stalled';
      break;
    }
    if (cost >= opts.maxCost) {
      stopReason = 'budget';
      break;
    }
  }
} finally {
  await browser.close();
}

// Ship the best round, not necessarily the last one.
const gameDir = ensureDir(path.join(ROOT, 'games', slug));
if (best && fs.existsSync(path.join(best.roundDir, 'index.html'))) {
  fs.copyFileSync(path.join(best.roundDir, 'index.html'), path.join(gameDir, 'index.html'));
}

log('── 工場の改善: 教訓を更新');
const lessons = await updateLessons({ rounds, runDir, mock: opts.mock });
cost += lessons.costUsd;
log(lessons.updated ? 'lessons.md を更新しました' : lessons.note);

const summary = { slug, brief: rel(briefPath), opts, stopReason, bestRound: best?.round, bestScore: best?.score, cost, rounds: rounds.map(strip) };
writeJson(path.join(runDir, 'summary.json'), summary);
const reportPath = writeReport(runDir, summary);

const label = { completed: '完成', stalled: '停滞で終了', budget: '費用上限で終了', max_rounds: '周回上限で終了' }[stopReason];
log(`${label}: ベストは${best?.round}周目（${best?.score}）→ ${rel(path.join(gameDir, 'index.html'))}`);
log(`レポート: ${rel(reportPath)}`);
process.exit(stopReason === 'completed' ? 0 : 1);

function strip(r) {
  return { ...r, roundDir: rel(r.roundDir) };
}
