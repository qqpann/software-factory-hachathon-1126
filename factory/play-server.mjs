import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { openGame } from './lib/browser.mjs';
import { ensureDir } from './lib/util.mjs';

/**
 * A tiny local HTTP server that holds one game page with a frozen clock.
 * The AI playtester drives it through factory/play.mjs, one action at a time.
 * Game time only advances inside an action, so thinking time is free.
 */
export async function startPlayServer(browser, htmlPath, outDir, { maxActions = 60, seed = 42 } = {}) {
  const shotDir = ensureDir(path.join(outDir, 'play'));
  const logPath = path.join(outDir, 'play-log.jsonl');
  fs.writeFileSync(logPath, '');
  let g = await openGame(browser, htmlPath, { seed });
  let step = 0;
  let errorsSeen = 0;
  let shiftSeen = (await g.layoutShift()).total;
  const allErrors = [];

  async function observe(action) {
    step++;
    const shot = path.join(shotDir, `${String(step).padStart(3, '0')}.png`);
    await g.screenshot(shot);
    const fresh = g.errors.slice(errorsSeen);
    errorsSeen = g.errors.length;
    allErrors.push(...fresh);
    const ls = await g.layoutShift();
    const shift = Math.round(Math.max(0, ls.total - shiftSeen) * 1000) / 1000;
    shiftSeen = ls.total;
    const res = {
      step,
      action,
      time_ms: g.time,
      game: await g.readGame(),
      screenshot: path.relative(outDir, shot),
      new_errors: fresh,
      layout_shift: shift,
      actions_left: Math.max(0, maxActions - step),
    };
    fs.appendFileSync(logPath, JSON.stringify(res) + '\n');
    return res;
  }

  const clamp = (v, lo, hi, d) => Math.min(hi, Math.max(lo, Number.isFinite(+v) ? +v : d));

  async function handle({ cmd, args = [] }) {
    if (step >= maxActions) return { error: '行動回数の上限に達しました。ここまでの体験で評価してください。', actions_left: 0 };
    switch (cmd) {
      case 'look':
        await g.advance(0);
        return observe('look');
      case 'press': {
        const key = args[0] || 'Space';
        await g.tap(key, 100);
        return observe(`press ${key}`);
      }
      case 'hold': {
        const keys = args[0] || 'ArrowRight';
        const ms = clamp(args[1], 50, 3000, 500);
        await g.hold(keys, ms);
        return observe(`hold ${keys} ${ms}`);
      }
      case 'click': {
        const x = clamp(args[0], 0, 960, 480);
        const y = clamp(args[1], 0, 720, 360);
        await g.click(x, y, 100);
        return observe(`click ${x} ${y}`);
      }
      case 'wait': {
        const ms = clamp(args[0], 50, 5000, 500);
        await g.advance(ms);
        return observe(`wait ${ms}`);
      }
      case 'restart': {
        await g.close();
        g = await openGame(browser, htmlPath, { seed: seed + step });
        errorsSeen = 0;
        shiftSeen = (await g.layoutShift()).total;
        return observe('restart');
      }
      default:
        return { error: `不明なコマンド: ${cmd}。look / press / hold / click / wait / restart が使えます。` };
    }
  }

  let queue = Promise.resolve();
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (d) => (body += d));
    req.on('end', () => {
      queue = queue.then(async () => {
        let out;
        try {
          out = await handle(JSON.parse(body || '{}'));
        } catch (e) {
          out = { error: e.message };
        }
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify(out));
      });
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address();

  return {
    url: `http://127.0.0.1:${port}/`,
    get steps() {
      return step;
    },
    get errors() {
      return allErrors;
    },
    async close() {
      await queue;
      server.close();
      await g.close();
    },
  };
}
