import { spawn } from 'node:child_process';

/**
 * Run Claude Code headless (`claude -p`) and return its final text and cost.
 * The prompt goes through stdin so long prompts are safe.
 */
export function runClaude({
  prompt,
  cwd,
  allowedTools = [],
  addDirs = [],
  model = process.env.FACTORY_MODEL,
  maxBudgetUsd = process.env.FACTORY_BUDGET_PER_CALL,
  env = {},
  permissionMode = 'acceptEdits',
  timeoutMs = 20 * 60 * 1000,
}) {
  const args = ['-p', '--output-format', 'json', '--permission-mode', permissionMode];
  if (model) args.push('--model', model);
  if (maxBudgetUsd) args.push('--max-budget-usd', String(maxBudgetUsd));
  for (const d of addDirs) args.push('--add-dir', d);
  if (allowedTools.length) args.push('--allowedTools', ...allowedTools);

  return new Promise((resolve) => {
    const child = spawn(process.env.FACTORY_CLAUDE_BIN || 'claude', args, {
      cwd,
      env: { ...process.env, ...env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => child.kill('SIGTERM'), timeoutMs);
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));
    child.on('error', (err) => {
      clearTimeout(timer);
      resolve({ ok: false, text: '', costUsd: 0, error: `claude を起動できません: ${err.message}` });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      let parsed = null;
      try {
        parsed = JSON.parse(stdout.trim().split('\n').filter(Boolean).pop() || 'null');
      } catch {
        /* not json */
      }
      const text = parsed?.result ?? stdout;
      const costUsd = Number(parsed?.total_cost_usd ?? parsed?.cost_usd ?? 0) || 0;
      const ok = code === 0 && !parsed?.is_error;
      resolve({ ok, text: String(text ?? ''), costUsd, error: ok ? null : (stderr || stdout).slice(-2000), raw: parsed });
    });
    child.stdin.end(prompt);
  });
}
