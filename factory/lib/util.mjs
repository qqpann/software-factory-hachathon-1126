import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const FACTORY_DIR = path.join(ROOT, 'factory');

export function rel(p) {
  return path.relative(ROOT, p) || '.';
}

export function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function readText(p, fallback = '') {
  try {
    return fs.readFileSync(p, 'utf8');
  } catch {
    return fallback;
  }
}

export function writeJson(p, data) {
  ensureDir(path.dirname(p));
  fs.writeFileSync(p, JSON.stringify(data, null, 2) + '\n');
}

export function readJson(p, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return fallback;
  }
}

export function fileUrl(p) {
  return pathToFileURL(path.resolve(p)).href;
}

export function timestamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

export function slugOf(briefPath) {
  return path.basename(briefPath).replace(/\.[^.]+$/, '').replace(/[^a-zA-Z0-9_-]+/g, '-').toLowerCase() || 'game';
}

/** Fill {{key}} placeholders in a prompt template. */
export function fill(template, vars) {
  return template.replace(/\{\{(\w+)\}\}/g, (_, k) => (k in vars ? String(vars[k]) : ''));
}

export function prompt(name) {
  return readText(path.join(FACTORY_DIR, 'prompts', `${name}.md`));
}

/** Pull the last ```json block (or a bare JSON object) out of model text. */
export function extractJson(text) {
  const blocks = [...String(text).matchAll(/```(?:json)?\s*([\s\S]*?)```/g)].map((m) => m[1]);
  const candidates = blocks.length ? blocks.reverse() : [];
  const brace = String(text).lastIndexOf('{');
  if (brace >= 0) candidates.push(String(text).slice(String(text).indexOf('{')));
  for (const c of candidates) {
    try {
      return JSON.parse(c.trim());
    } catch {
      /* try next */
    }
  }
  return null;
}

export function log(...args) {
  const t = new Date().toTimeString().slice(0, 8);
  console.log(`[${t}]`, ...args);
}

/** Parse --key value / --flag style args. Positional args go to _. */
export function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) out[key] = true;
      else {
        out[key] = next;
        i++;
      }
    } else out._.push(a);
  }
  return out;
}
