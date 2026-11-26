import path from 'node:path';
import { launchBrowser, openGame, startGame, PLAY_KEYS } from './lib/browser.mjs';
import { staticCheck } from './static-check.mjs';
import { ensureDir, writeJson, parseArgs, rel } from './lib/util.mjs';

const VALID_STATES = ['title', 'playing', 'won', 'lost'];

function mulberry(seed) {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Machine checks that need a browser but no AI. Genre-agnostic: relies only on
 * the window.__game contract and on pixels changing.
 */
export async function runGate(htmlPath, outDir, { browser: shared } = {}) {
  ensureDir(outDir);
  const checks = [];
  const add = (id, pass, detail, required = true) => checks.push({ id, pass: !!pass, required, detail });
  const shots = [];
  const errors = [];

  const st = staticCheck(htmlPath);
  checks.push(...st.checks.map((c) => ({ ...c, id: `static.${c.id}` })));
  if (!st.pass) return finish();

  const browser = shared || (await launchBrowser());
  try {
    // 1. Load + contract
    const g = await openGame(browser, htmlPath, { seed: 7 });
    await g.advance(700);
    const s0 = await g.readGame();
    add('loads_without_errors', g.errors.length === 0, g.errors.length ? g.errors.slice(0, 5).join(' | ') : '読み込み時のエラーなし');
    add('no_network', g.external.length === 0, g.external.length ? `通信しようとした: ${g.external.slice(0, 3).join(', ')}` : '外部通信なし');
    add('contract_present', !!s0, s0 ? `state=${s0.state} score=${s0.score}` : 'window.__game がありません');
    const fieldsOk = s0 && VALID_STATES.includes(s0.state) && Number.isFinite(s0.score) && s0.goal && s0.controls && s0.title;
    add('contract_fields', fieldsOk, fieldsOk ? `「${s0.title}」 goal=${s0.goal} / controls=${s0.controls}` : `不足または不正: ${JSON.stringify(s0)}`);
    const titleShot = path.join(outDir, 'gate-title.png');
    const titleBuf = await g.screenshot(titleShot);
    shots.push(titleShot);
    add('not_blank', titleBuf.length > 4000, `タイトル画面のPNG ${titleBuf.length} bytes`);

    // 2. Start
    const started = s0 ? await startGame(g) : false;
    add('starts_with_space_or_enter', started, started ? 'Space/Enterで playing になった' : `playing にならない (state=${(await g.readGame())?.state})`);
    errors.push(...g.errors);
    await g.close();

    // 3. Input changes the screen: same seed + same time, with and without input.
    if (started) {
      const run = async (withInput) => {
        const h = await openGame(browser, htmlPath, { seed: 11 });
        await startGame(h);
        if (withInput) {
          for (const k of ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'Space']) await h.hold(k, 250);
        } else await h.advance(1000);
        const buf = await h.page.screenshot();
        errors.push(...h.errors);
        await h.close();
        return buf;
      };
      const [a, b, c] = [await run(false), await run(false), await run(true)];
      const deterministic = a.equals(b);
      const responsive = !c.equals(a);
      add(
        'input_changes_screen',
        responsive,
        deterministic
          ? responsive
            ? '入力ありと入力なしで画面が変わる'
            : '入力しても画面が変わらない'
          : '描画が非決定的なため参考判定（Math.random以外の乱数源？）',
      );
    }

    // 4. Monkey play: random inputs for 90s of game time.
    if (started) {
      const m = await openGame(browser, htmlPath, { seed: 23 });
      await startGame(m);
      const rnd = mulberry(5);
      const seen = new Set();
      let badScore = null;
      let ended = null;
      let restarted = null;
      const first = await m.readGame();
      let changed = false;
      for (let t = 0; t < 90000; ) {
        const key = PLAY_KEYS[Math.floor(rnd() * PLAY_KEYS.length)];
        const ms = 80 + Math.floor(rnd() * 400);
        await m.hold(key, ms);
        t += ms;
        const s = await m.readGame();
        if (!s) break;
        seen.add(s.state);
        if (!Number.isFinite(s.score)) badScore = s.score;
        if (s.score !== first.score || s.state !== first.state) changed = true;
        if ((s.state === 'won' || s.state === 'lost') && !ended) {
          ended = s.state;
          const endShot = path.join(outDir, 'gate-end.png');
          await m.screenshot(endShot);
          shots.push(endShot);
          await m.tap('Space', 300);
          let r = await m.readGame();
          if (r?.state !== 'playing' && r?.state !== 'title') {
            await m.tap('Enter', 300);
            r = await m.readGame();
          }
          if (r?.state === 'title') {
            await m.tap('Space', 300);
            r = await m.readGame();
          }
          restarted = r?.state === 'playing';
          break;
        }
      }
      const playShot = path.join(outDir, 'gate-play.png');
      await m.screenshot(playShot);
      shots.push(playShot);
      add('no_runtime_errors', m.errors.length === 0, m.errors.length ? m.errors.slice(0, 5).join(' | ') : 'ランダム操作90秒でエラーなし');
      add('score_is_finite', badScore === null, badScore === null ? 'score は常に有限' : `score が不正: ${badScore}`);
      add('game_progresses', changed, changed ? 'state か score が動いた' : 'ランダム操作で何も変化しない');
      add('game_can_end', !!ended, ended ? `ランダム操作で ${ended} に到達` : '90秒で決着しなかった（参考）', false);
      if (ended) add('can_restart', restarted, restarted ? 'Space/Enterでやり直せる' : 'やり直せない');
      errors.push(...m.errors);
      await m.close();
    }
  } finally {
    if (!shared) await browser.close();
  }
  return finish();

  function finish() {
    const required = checks.filter((c) => c.required);
    const result = {
      pass: required.every((c) => c.pass),
      passed: required.filter((c) => c.pass).length,
      total: required.length,
      checks,
      screenshots: shots.map((s) => path.basename(s)),
      errors: [...new Set(errors)].slice(0, 20),
    };
    writeJson(path.join(outDir, 'gate.json'), result);
    return result;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = parseArgs(process.argv.slice(2));
  const html = args._[0];
  if (!html) {
    console.error('使い方: node factory/gate.mjs path/to/index.html [--out dir]');
    process.exit(2);
  }
  const out = args.out || path.join(path.dirname(html), 'gate');
  runGate(html, out)
    .then((r) => {
      for (const c of r.checks) console.log(`${c.pass ? '✓' : c.required ? '✗' : '·'} ${c.id}: ${c.detail}`);
      console.log(`\n${r.pass ? 'PASS' : 'FAIL'} (${r.passed}/${r.total}) → ${rel(path.join(out, 'gate.json'))}`);
      process.exit(r.pass ? 0 : 1);
    })
    .catch((e) => {
      console.error(e.message);
      process.exit(2);
    });
}
