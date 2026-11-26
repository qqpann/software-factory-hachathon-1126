import fs from 'node:fs';
import path from 'node:path';

/** A Markdown report for the demo: score per round, screenshots, what changed. */
export function writeReport(runDir, s) {
  const label = { completed: '完成', stalled: '停滞で終了', budget: '費用上限で終了', max_rounds: '周回上限で終了' }[s.stopReason];
  const lines = [
    `# ${s.slug} の生成レポート`,
    '',
    `- 結果: **${label}**（ベストは${s.bestRound}周目、スコア ${s.bestScore}）`,
    `- brief: \`${s.brief}\``,
    `- 周回数: ${s.rounds.length}、費用: $${Number(s.cost).toFixed(2)}`,
    '',
    '## スコアの推移',
    '',
    '| 周 | スコア | 機械判定 | 試遊 | 結果 | 費用 |',
    '| -- | -- | -- | -- | -- | -- |',
  ];
  for (const r of s.rounds) {
    const pt = r.playtest;
    lines.push(
      `| ${r.round} | ${r.score} | ${r.gate.passed}/${r.gate.total} | ${pt ? pt.total : '-'} | ${pt?.review?.reached ?? '-'} | $${((r.build.costUsd || 0) + (pt?.costUsd || 0)).toFixed(2)} |`,
    );
  }
  lines.push('', '`' + bar(s.rounds.map((r) => r.score)) + '`', '');
  for (const r of s.rounds) {
    const dir = path.basename(r.roundDir);
    lines.push(`## ${r.round}周目`, '');
    const failed = r.gate.checks.filter((c) => !c.pass && c.required);
    lines.push(failed.length ? `機械判定で落ちた項目: ${failed.map((c) => c.id).join(', ')}` : '機械判定はすべて通過。', '');
    if (r.playtest?.review) {
      const rv = r.playtest.review;
      lines.push(`試遊AI: ${rv.summary || ''}`, '');
      for (const b of rv.bugs || []) lines.push(`- 不具合: ${b.what}`);
      for (const f of rv.fixes || []) lines.push(`- 修正依頼: ${f}`);
      lines.push('');
    }
    const shot = ['gate-play.png', 'gate-title.png'].find((f) => fs.existsSync(path.join(runDir, dir, f)));
    if (shot) lines.push(`![${r.round}周目](${dir}/${shot})`, '');
  }
  const p = path.join(runDir, 'report.md');
  fs.writeFileSync(p, lines.join('\n') + '\n');
  return p;
}

function bar(values) {
  const ticks = '▁▂▃▄▅▆▇█';
  return values.map((v) => ticks[Math.min(7, Math.max(0, Math.round(v * 7)))]).join('');
}
