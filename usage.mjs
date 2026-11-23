import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

export function summarizeUsage(dir, project) {
  const totals = { codex: 0, claude: 0, inkling: 0, custom: 0 };
  const byAi = {};
  const selected = { ...totals };
  let missing = 0;
  const normalized = path => process.platform === 'win32' ? resolve(path).toLowerCase() : resolve(path);
  function add(name, tokens, path) {
    if (!Number.isSafeInteger(tokens) || tokens < 0) { missing++; return; }
    totals[name] += tokens;
    if (project && path && normalized(path) === normalized(project)) selected[name] += tokens;
  }
  for (const entry of existsSync(dir) ? readdirSync(dir, { withFileTypes: true }) : []) {
    const folder = join(dir, entry.name);
    try {
      if (entry.isFile() && /^inkling-.*\.usage\.json$/.test(entry.name)) {
        const record = JSON.parse(readFileSync(folder, 'utf8'));
        add('inkling', record.tokens, record.project);
      }
      if (entry.isFile() && /^custom-.*\.usage\.json$/.test(entry.name)) {
        const record = JSON.parse(readFileSync(folder, 'utf8'));
        add('custom', record.tokens, record.project);
        if (Number.isSafeInteger(record.tokens)) byAi[record.ai] = (byAi[record.ai] || 0) + record.tokens;
      }
      if (!entry.isDirectory() || !existsSync(join(folder, 'plan.json'))) continue;
      const plan = JSON.parse(readFileSync(join(folder, 'plan.json'), 'utf8'));
      for (const file of readdirSync(folder)) {
        if (/^\d+-codex\.stderr\.log$/.test(file)) {
          const log = readFileSync(join(folder, file), 'utf8');
          const value = log.match(/(?:^|\n)tokens used\r?\n([\d ,\u00a0\u202f]+)\s*$/i);
          add('codex', value ? Number(value[1].replace(/\D/g, '')) : undefined, plan.project);
        } else if (/^\d+-claude\.stdout\.log$/.test(file)) {
          const u = JSON.parse(readFileSync(join(folder, file), 'utf8')).usage;
          add('claude', u && Number.isFinite(u.input_tokens) && Number.isFinite(u.output_tokens)
            ? u.input_tokens + u.output_tokens + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0)
            : undefined, plan.project);
        }
      }
    } catch { missing++; }
  }
  return { totals, selected, missing, byAi };
}
