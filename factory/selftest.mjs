#!/usr/bin/env node
// 工場そのもののテスト。ブラウザが無い環境ではブラウザ部分を飛ばします。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { staticCheck } from './static-check.mjs';
import { feedbackText } from './build.mjs';
import { scorePlaytest, SCORE_KEYS } from './playtest.mjs';
import { historyText } from './lessons.mjs';
import { writeReport } from './report.mjs';
import { minClearMinutes, volumeCheck } from './volume.mjs';
import { runClaude } from './lib/claude.mjs';
import { extractJson, FACTORY_DIR, ROOT, prompt } from './lib/util.mjs';

const fx = (n) => path.join(FACTORY_DIR, 'fixtures', n);
let failures = 0;
async function test(name, fn) {
  try {
    await fn();
    console.log(`✓ ${name}`);
  } catch (e) {
    failures++;
    console.log(`✗ ${name}\n  ${e.message}`);
  }
}

await test('全モジュールが構文エラーなし', () => {
  for (const f of fs.readdirSync(FACTORY_DIR, { recursive: true })) {
    if (String(f).endsWith('.mjs')) execFileSync(process.execPath, ['--check', path.join(FACTORY_DIR, f)]);
  }
});

await test('静的チェック: 見本ゲームは通る', () => {
  const r = staticCheck(fx('sample-dodge.html'));
  assert.ok(r.pass, JSON.stringify(r.checks));
});

await test('静的チェック: 壊れた見本は外部参照と構文エラーと契約なしで落ちる', () => {
  const r = staticCheck(fx('broken.html'));
  const failed = r.checks.filter((c) => !c.pass).map((c) => c.id).sort();
  assert.equal(r.pass, false);
  assert.deepEqual(failed, ['mentions_contract', 'no_external_resources', 'scripts_parse']);
});

await test('試遊スコア: 1〜5を0〜1に正規化（品質基準の3項目を含む）', () => {
  const all = (v) => Object.fromEntries(SCORE_KEYS.map((k) => [k, v]));
  assert.ok(['visuals', 'stability', 'depth'].every((k) => SCORE_KEYS.includes(k)));
  assert.equal(scorePlaytest({ scores: all(5) }), 1);
  assert.equal(scorePlaytest({ scores: all(1) }), 0);
  assert.equal(scorePlaytest({ scores: all(4) }), 0.75);
  assert.equal(scorePlaytest(null), 0);
});

await test('作る係と試遊係のプロンプトに品質基準が入る', () => {
  for (const name of ['builder', 'playtester']) assert.ok(prompt(name).includes('{{quality}}'), name);
  assert.ok(fs.readFileSync(path.join(ROOT, 'QUALITY.md'), 'utf8').includes('レイアウト'));
});

await test('ボリューム: brief の最低クリア時間を読み、早すぎるクリアを落とす', () => {
  assert.equal(minClearMinutes('- クリアまで最低 5 分はかかる'), 5);
  assert.equal(minClearMinutes('テーマだけ'), null);
  const fast = volumeCheck({ clears_ms: [105000] }, 5);
  assert.equal(fast.pass, false);
  assert.equal(fast.factor, 0.35);
  assert.ok(fast.detail.includes('1分45秒'), fast.detail);
  assert.equal(volumeCheck({ clears_ms: [360000] }, 5).pass, true);
  assert.equal(volumeCheck({ clears_ms: [] }, 5).pass, null);
  assert.equal(volumeCheck({ clears_ms: [1000] }, null).factor, 1);
  const t = feedbackText({ round: 1, volume: fast });
  assert.ok(t.includes('ボリューム不足'), t);
});

await test('JSON抽出: 最後のjsonブロックを読む', () => {
  assert.deepEqual(extractJson('前置き\n```json\n{"a":1}\n```\n後で\n```json\n{"a":2}\n```'), { a: 2 });
  assert.deepEqual(extractJson('結果: {"x": [1,2]}'), { x: [1, 2] });
});

const fakeRound = {
  round: 1,
  roundDir: 'runs/x/round-1',
  score: 0.4,
  build: { ok: true, costUsd: 0.5 },
  gate: { pass: false, passed: 5, total: 8, checks: [{ id: 'starts_with_space_or_enter', pass: false, required: true, detail: 'playing にならない' }], errors: ['pageerror: x is not defined'] },
  playtest: { total: 0.5, costUsd: 0.3, review: { reached: 'lost', summary: '操作が重い', scores: { fun: 3 }, bugs: [{ what: '当たり判定が大きい', evidence: 'play/003.png' }], fixes: ['当たり判定を小さく'] } },
};

await test('作る係へのフィードバックに落ちた項目と試遊の指摘が入る', () => {
  const t = feedbackText(fakeRound);
  for (const s of ['starts_with_space_or_enter', 'pageerror', '当たり判定が大きい', 'play/003.png', '当たり判定を小さく']) assert.ok(t.includes(s), s);
  assert.equal(feedbackText(undefined), '');
});

await test('教訓用の履歴とレポートを書ける', () => {
  assert.ok(historyText([fakeRound]).includes('機械判定NG'));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'factory-report-'));
  const p = writeReport(dir, { slug: 'x', brief: 'briefs/x.md', stopReason: 'stalled', bestRound: 1, bestScore: 0.4, cost: 0.8, rounds: [fakeRound] });
  const md = fs.readFileSync(p, 'utf8');
  assert.ok(md.includes('停滞で終了') && md.includes('| 1 | 0.4 | 5/8 | 0.5 | lost | - |'));
});

await test('claude -p の JSON 出力から本文と費用を読む（偽のclaude）', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fake-claude-'));
  const bin = path.join(dir, 'claude');
  fs.writeFileSync(
    bin,
    `#!/usr/bin/env node
let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{console.log(JSON.stringify({type:'result',is_error:false,result:'echo:'+s.length+':'+process.argv.slice(2).join(' '),total_cost_usd:0.12}))});`,
  );
  fs.chmodSync(bin, 0o755);
  process.env.FACTORY_CLAUDE_BIN = bin;
  const r = await runClaude({ prompt: 'hello', cwd: dir, allowedTools: ['Read', 'Write'] });
  delete process.env.FACTORY_CLAUDE_BIN;
  assert.ok(r.ok, r.error);
  assert.equal(r.costUsd, 0.12);
  assert.ok(r.text.startsWith('echo:5:-p --output-format json'), r.text);
  assert.ok(r.text.includes('--allowedTools Read Write'), r.text);
});

// ---- Browser part ----
let browser = null;
try {
  const { launchBrowser } = await import('./lib/browser.mjs');
  browser = await launchBrowser();
} catch (e) {
  console.log(`· ブラウザ部分はスキップ: ${e.message.split('\n')[0]}`);
}

if (browser) {
  const { runGate } = await import('./gate.mjs');
  const { startPlayServer } = await import('./play-server.mjs');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'factory-gate-'));

  await test('機械判定: 見本ゲームは合格', async () => {
    const r = await runGate(fx('sample-dodge.html'), path.join(tmp, 'ok'), { browser });
    assert.ok(r.pass, r.checks.filter((c) => !c.pass).map((c) => `${c.id}: ${c.detail}`).join('\n'));
  });

  await test('機械判定: マウスだけで遊ぶ見本も合格', async () => {
    const r = await runGate(fx('sample-clicker.html'), path.join(tmp, 'click'), { browser });
    assert.ok(r.pass, r.checks.filter((c) => !c.pass).map((c) => `${c.id}: ${c.detail}`).join('\n'));
  });

  await test('機械判定: 操作で文字やボタンがずれる見本はレイアウトシフトで落ちる', async () => {
    const r = await runGate(fx('shifty.html'), path.join(tmp, 'shift'), { browser });
    const failed = r.checks.filter((c) => !c.pass && c.required).map((c) => c.id);
    assert.deepEqual(failed, ['no_layout_shift']);
  });

  await test('機械判定: 壊れた見本は不合格', async () => {
    const r = await runGate(fx('broken.html'), path.join(tmp, 'ng'), { browser });
    assert.equal(r.pass, false);
  });

  await test('試遊サーバー: 時間を止めたまま操作して状態とスクショが返る', async () => {
    const dir = path.join(tmp, 'play');
    const s = await startPlayServer(browser, fx('sample-dodge.html'), dir, { maxActions: 5 });
    const call = (cmd, ...args) => fetch(s.url, { method: 'POST', body: JSON.stringify({ cmd, args }) }).then((r) => r.json());
    const a = await call('look');
    assert.equal(a.game.state, 'title');
    const b = await call('press', 'Space');
    assert.equal(b.game.state, 'playing');
    const c = await call('look');
    assert.equal(c.time_ms, b.time_ms, 'look で時間が進んだ');
    const d = await call('hold', 'ArrowLeft', 1000);
    assert.ok(d.time_ms - c.time_ms === 1000 && d.game.score >= 9, JSON.stringify(d));
    assert.ok(fs.existsSync(path.join(dir, d.screenshot)));
    assert.equal(d.layout_shift, 0, 'layout_shift が返らない');
    await call('wait', 100);
    const f = await call('look');
    assert.ok(f.error && f.actions_left === 0, '上限が効かない');
    await s.close();
  });

  await test('試遊サーバー: クリアまでのゲーム内時間を測る', async () => {
    const s = await startPlayServer(browser, fx('sample-clicker.html'), path.join(tmp, 'clear'), { maxActions: 40 });
    const call = (cmd, ...args) => fetch(s.url, { method: 'POST', body: JSON.stringify({ cmd, args }) }).then((r) => r.json());
    await call('press', 'Space');
    let last;
    for (let i = 0; i < 30; i++) last = await call('click', 480, 360);
    assert.equal(last.game.state, 'won');
    assert.equal(s.clears.length, 1);
    assert.ok(s.clears[0] >= 3000 && s.clears[0] < 6000, String(s.clears[0]));
    await s.close();
  });
  await browser.close();
}

console.log(failures ? `\n${failures}件失敗` : '\nすべて成功');
process.exit(failures ? 1 : 0);
