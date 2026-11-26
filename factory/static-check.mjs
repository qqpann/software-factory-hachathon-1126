import fs from 'node:fs';
import vm from 'node:vm';

/**
 * Cheap checks that need no browser: single file, no external resources,
 * inline scripts parse, and the contract hook is mentioned.
 */
export function staticCheck(htmlPath) {
  const checks = [];
  const add = (id, pass, detail, required = true) => checks.push({ id, pass: !!pass, required, detail });

  if (!fs.existsSync(htmlPath)) {
    add('file_exists', false, 'index.html がありません');
    return { pass: false, checks };
  }
  const html = fs.readFileSync(htmlPath, 'utf8');
  const kb = Math.round(Buffer.byteLength(html) / 1024);
  add('file_exists', true, `${kb}KB`);
  add('size_limit', kb <= 400, `${kb}KB（上限400KB）`);

  const externalRefs = [
    ...html.matchAll(/<(?:script|link|img|audio|video|source|iframe)\b[^>]*?\b(?:src|href)\s*=\s*["']?\s*((?:https?:)?\/\/[^"'\s>]+)/gi),
    ...html.matchAll(/(?:fetch|import)\s*\(\s*["'`]((?:https?:)?\/\/[^"'`]+)/gi),
    ...html.matchAll(/@import\s+(?:url\()?["']?((?:https?:)?\/\/[^"')]+)/gi),
    ...html.matchAll(/\bimport\s+[^;]*?from\s+["']((?:https?:)?\/\/[^"']+)/gi),
  ].map((m) => m[1]);
  add('no_external_resources', externalRefs.length === 0, externalRefs.length ? `外部参照: ${externalRefs.slice(0, 5).join(', ')}` : '外部参照なし');

  const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)];
  const syntaxErrors = [];
  let classic = 0;
  for (const [, attrs, code] of scripts) {
    if (/\bsrc\s*=/.test(attrs)) continue;
    if (/type\s*=\s*["']?module/i.test(attrs)) continue; // modules are checked in the browser gate
    if (/type\s*=\s*["']?(?!text\/javascript|application\/javascript)[^"'\s>]+/i.test(attrs)) continue;
    classic++;
    try {
      new vm.Script(code, { filename: 'inline-script.js' });
    } catch (e) {
      syntaxErrors.push(e.message);
    }
  }
  add('scripts_parse', syntaxErrors.length === 0, syntaxErrors.length ? syntaxErrors.join(' / ') : `インラインscript ${classic}個 OK`);
  add('mentions_contract', /__game/.test(html), /__game/.test(html) ? 'window.__game あり' : 'window.__game が見当たりません');

  return { pass: checks.every((c) => c.pass || !c.required), checks };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const r = staticCheck(process.argv[2] || 'index.html');
  console.log(JSON.stringify(r, null, 2));
  process.exit(r.pass ? 0 : 1);
}
