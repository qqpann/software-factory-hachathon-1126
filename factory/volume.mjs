// ボリュームの判定。試遊AIが実際にクリアまでにかかったゲーム内時間を測り、
// brief の「クリアまで最低 N 分」より短ければ「中身が足りない」とみなす。

/** brief から「最低 N 分」を読む。書かれていなければ null。 */
export function minClearMinutes(brief) {
  const m = String(brief).match(/最低\s*([0-9]+(?:\.[0-9]+)?)\s*分/);
  return m ? Number(m[1]) : null;
}

export function fmtTime(ms) {
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)}分${String(s % 60).padStart(2, '0')}秒`;
}

/**
 * { pass, factor, clearMs, minMs, detail }。factor (0..1) は試遊点にかける係数で、
 * 早すぎるクリアほど小さい。クリアしていなければ測れないので pass=null。
 */
export function volumeCheck(playtest, minMinutes) {
  if (!minMinutes) return { pass: null, factor: 1, detail: 'brief に最低クリア時間がないため判定しない' };
  const minMs = minMinutes * 60000;
  const clearMs = playtest?.clears_ms?.[0];
  if (!Number.isFinite(clearMs)) {
    return { pass: null, factor: 1, minMs, detail: `試遊AIはクリアしなかったため測れない（最低 ${minMinutes}分）` };
  }
  const pass = clearMs >= minMs;
  return {
    pass,
    factor: pass ? 1 : Math.round(Math.max(0, clearMs / minMs) * 100) / 100,
    clearMs,
    minMs,
    detail: pass
      ? `試遊AIのクリアまで ${fmtTime(clearMs)}（最低 ${minMinutes}分）`
      : `ボリューム不足: 試遊AIが ${fmtTime(clearMs)} でクリアした（最低 ${minMinutes}分）。待つ時間を延ばすのではなく、段階・仕組み・判断を増やして中身で長くする`,
  };
}
