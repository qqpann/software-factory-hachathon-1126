import { fileUrl } from './util.mjs';

export const VIEWPORT = { width: 960, height: 720 };
const START_TIME = Date.parse('2030-01-01T00:00:00Z');

/** Deterministic Math.random so two runs with the same inputs render the same frames. */
function seedScript(seed) {
  return `(() => {
    let s = ${seed >>> 0} | 0;
    Math.random = function () {
      s = (s + 0x6D2B79F5) | 0;
      let t = Math.imul(s ^ (s >>> 15), 1 | s);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  })();`;
}

export async function launchBrowser() {
  let chromium;
  try {
    ({ chromium } = await import('playwright'));
  } catch {
    throw new Error('playwright が見つかりません。`npm install` を実行してください。');
  }
  try {
    return await chromium.launch({ executablePath: process.env.FACTORY_CHROME || undefined });
  } catch (e) {
    throw new Error(
      `ブラウザを起動できません。\`npx playwright install chromium\` を実行するか、FACTORY_CHROME にChromeのパスを指定してください。\n${e.message.split('\n')[0]}`,
    );
  }
}

/**
 * Open a game with a frozen, manually advanced clock.
 * Time only moves when advance()/hold()/tap() is called, so a slow AI player
 * can play a real-time game turn by turn.
 */
export async function openGame(browser, htmlPath, { seed = 1 } = {}) {
  const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 1 });
  await context.addInitScript(seedScript(seed));
  const errors = [];
  const external = [];
  await context.route('**/*', (route) => {
    const url = route.request().url();
    if (url.startsWith('file:') || url.startsWith('data:') || url.startsWith('blob:') || url === 'about:blank') {
      return route.continue();
    }
    external.push(url);
    return route.abort();
  });
  const page = await context.newPage();
  page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(`console.error: ${msg.text()}`);
  });

  await page.clock.install({ time: START_TIME });
  await page.goto(fileUrl(htmlPath), { waitUntil: 'load', timeout: 15000 });
  // Let the page load on real time, then freeze. The margin must exceed load time.
  await page.clock.pauseAt(START_TIME + 5000);
  let now = 0;

  const g = {
    page,
    context,
    errors,
    external,
    get time() {
      return now;
    },
    async advance(ms) {
      ms = Math.max(0, Math.round(ms));
      if (ms) await page.clock.runFor(ms);
      now += ms;
    },
    async readGame() {
      return page.evaluate(() => {
        const g = window.__game;
        if (!g || typeof g !== 'object') return null;
        const pick = (v) => (typeof v === 'string' ? v.slice(0, 200) : v);
        return { state: g.state, score: g.score, title: pick(g.title), goal: pick(g.goal), controls: pick(g.controls) };
      });
    },
    async hold(keys, ms) {
      const list = (Array.isArray(keys) ? keys : String(keys).split('+')).filter(Boolean);
      for (const k of list) await page.keyboard.down(k);
      await g.advance(ms);
      for (const k of [...list].reverse()) await page.keyboard.up(k);
    },
    async tap(key, after = 100) {
      await g.hold(key, 50);
      await g.advance(after);
    },
    async click(x, y, after = 100) {
      await page.mouse.click(x, y);
      await g.advance(after);
    },
    async screenshot(path) {
      return page.screenshot({ path, animations: 'allow', timeout: 10000 });
    },
    async close() {
      await context.close();
    },
  };
  await g.advance(300);
  return g;
}

/** Press Space, then Enter, until the game reports 'playing'. */
export async function startGame(g) {
  for (const key of ['Space', 'Enter', 'Space']) {
    const s = await g.readGame();
    if (s?.state === 'playing') return true;
    await g.tap(key, 200);
  }
  return (await g.readGame())?.state === 'playing';
}

export const PLAY_KEYS = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Space', 'KeyZ', 'KeyX', 'KeyA', 'KeyD', 'KeyW', 'KeyS'];
