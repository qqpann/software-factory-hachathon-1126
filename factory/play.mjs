#!/usr/bin/env node
// The playtester's controller. Each call is one action; the game clock is
// frozen between calls. Prints JSON with the new screenshot path and state.
//
//   node factory/play.mjs look
//   node factory/play.mjs press Space
//   node factory/play.mjs hold ArrowLeft 600
//   node factory/play.mjs hold ArrowUp+ArrowRight 400
//   node factory/play.mjs click 480 360
//   node factory/play.mjs wait 1000
//   node factory/play.mjs restart

const url = process.env.FACTORY_PLAY_URL;
if (!url) {
  console.error('FACTORY_PLAY_URL が設定されていません（試遊中だけ使えます）');
  process.exit(2);
}
const [cmd = 'look', ...args] = process.argv.slice(2);
const res = await fetch(url, { method: 'POST', body: JSON.stringify({ cmd, args }) });
console.log(JSON.stringify(await res.json(), null, 1));
