import modelSettings from './model-settings.cjs';
import { summarizeUsage } from './usage.mjs';
import { spawn, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, extname, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';

const home = dirname(fileURLToPath(import.meta.url));
const windows = process.platform === 'win32';
const endpoint = 'http://127.0.0.1:8001/v1';
const model = 'inkling-2-mini';
const providerEnv = { ...process.env };
for (const key of Object.keys(providerEnv)) {
  if (/^(OPENAI_API_KEY|OPENAI_BASE_URL|ANTHROPIC_.*|CLAUDE_CODE_OAUTH_TOKEN|CLAUDE_CODE_USE_.*)$/i.test(key) ||
      (/^CODEX_/i.test(key) && key.toUpperCase() !== 'CODEX_HOME')) {
    delete providerEnv[key];
  }
}

const stepSchema = {
  type: 'object', additionalProperties: false,
  required: ['agent', 'role', 'task', 'acceptance'],
  properties: {
    agent: { enum: ['codex', 'claude'] },
    role: { enum: ['implement', 'review'] },
    task: { type: 'string', minLength: 1, maxLength: 420 },
    acceptance: { type: 'string', minLength: 1, maxLength: 300 },
  },
};
const planSchema = {
  type: 'object', additionalProperties: false, required: ['steps'],
  properties: { steps: { type: 'array', minItems: 2, maxItems: 5, items: stepSchema } },
};

function command(executable, args, cwd = home, env = process.env, includeStderr = false) {
  const result = spawnSync(executable, args, { cwd, env, encoding: 'utf8', windowsHide: true, timeout: 30000 });
  if (result.error || result.status !== 0) {
    throw new Error(`${executable} ${args[0]}: ${result.stderr?.trim() || result.error?.message || result.stdout?.trim() || result.status}`);
  }
  return (includeStderr ? `${result.stdout}\n${result.stderr}` : result.stdout).trim();
}

function git(cwd, ...args) {
  return command('git', args, cwd);
}

function nativeCli(agent) {
  if (!windows) return agent;
  const override = process.env[`ORCHESTRATOR_${agent.toUpperCase()}_EXE`];
  if (override) return resolve(override);
  if (agent === 'codex' && process.arch === 'x64') {
    const bundled = join(home, '.runtime', 'codex', 'node_modules', '@openai', 'codex-win32-x64', 'vendor', 'x86_64-pc-windows-msvc', 'bin', 'codex.exe');
    if (existsSync(bundled)) return bundled;
  }
  const result = spawnSync('where.exe', [`${agent}.exe`], { encoding: 'utf8', windowsHide: true });
  const found = result.stdout?.trim().split(/\r?\n/)[0];
  if (found) return found;
  if (agent === 'claude') {
    const npm = spawnSync('where.exe', ['claude.cmd'], { encoding: 'utf8', windowsHide: true });
    const shim = npm.stdout?.trim().split(/\r?\n/)[0];
    if (shim) {
      const binary = join(dirname(shim), 'node_modules', '@anthropic-ai', 'claude-code', 'bin', 'claude.exe');
      if (existsSync(binary)) return binary;
    }
  }
  throw new Error(`Не найден ${agent}.exe. Укажи ORCHESTRATOR_${agent.toUpperCase()}_EXE.`);
}

function auth(agent) {
  const executable = nativeCli(agent);
  if (agent === 'codex') {
    const status = command(executable, ['login', 'status'], home, providerEnv, true);
    if (!/ChatGPT/i.test(status)) throw new Error('Codex: нужен вход через ChatGPT (`codex login`).');
  } else {
    let status;
    try {
      status = JSON.parse(command(executable, ['auth', 'status'], home, providerEnv));
    } catch {
      throw new Error('Claude Code: выполни `claude auth login` и войди через Claude.ai.');
    }
    if (!status.loggedIn || status.authMethod !== 'claude.ai' || status.apiProvider !== 'firstParty') {
      throw new Error('Claude Code: нужен вход через Claude.ai (`claude auth login`).');
    }
  }
  return executable;
}

function validatePlan(steps) {
  if (!Array.isArray(steps) || steps.length < 1 || steps.length > 5) throw new Error('Нужно от 1 до 5 шагов.');
  for (const step of steps) {
    if (!step || !['codex', 'claude'].includes(step.agent) || !['implement', 'review'].includes(step.role) ||
        ![step.task, step.acceptance].every(value => typeof value === 'string' && value.trim() && value.length <= 3000)) {
      throw new Error('Некорректный шаг плана.');
    }
  }
  if (steps.length === 1 && steps[0].role === 'implement') return;
  const last = steps.at(-1);
  const lastImplementation = steps.findLast(step => step.role === 'implement');
  if (steps[0].role !== 'implement' || last.role !== 'review' ||
      lastImplementation.agent === last.agent) {
    throw new Error('План должен начинаться реализацией и заканчиваться проверкой другим агентом.');
  }
}

async function localRequest(path, options) {
  let response;
  try {
    response = await fetch(endpoint + path, { signal: AbortSignal.timeout(360000), ...options });
  } catch (error) {
    throw new Error(`Inkling по адресу ${endpoint}: ${error.cause?.code || error.message}. Запуск: .\\inkling.ps1`);
  }
  if (!response.ok) throw new Error(`Inkling HTTP ${response.status}: ${(await response.text()).slice(0, 600)}`);
  return response.json();
}

async function checkModel() {
  const models = await localRequest('/models');
  if (!models.data?.some(entry => entry.id === model)) throw new Error(`На ${endpoint} не найден ${model}.`);
}

async function plan(project, goal, out, agent, models, lead = null) {
  if (goal.length > 3000) throw new Error('Сократи описание задачи до 3000 символов.');
  let base = null;
  try { base = git(project, 'rev-parse', '--verify', 'HEAD'); } catch {} 
  writePlan(project, base, goal, out, agent === 'auto' ? await inklingSteps(project, base, goal, lead) : [
    { agent, role: 'implement', task: goal, acceptance: 'Выполнено исходное задание.' },
  ], models);
}

async function inklingSteps(project, base, goal, lead = null) {
  await checkModel();
  const files = (base ? git(project, 'ls-tree', '--name-only', base) : readdirSync(project).filter(name => name !== '.git').join('\n')).slice(0, 3000);
  console.log('Inkling составляет план…');
  const response = await localRequest('/chat/completions', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model, max_tokens: 1100,
      response_format: { type: 'json_object', schema: planSchema },
      messages: [
        { role: 'system', content: 'Return a compact JSON plan {steps:[{agent,role,task,acceptance}]}. Use both codex and claude. First implement, then finish with read-only review by an agent other than the last implementer. Steps run in order in the same project directory. Use two steps for simple tasks. Write one short sentence per field in the user’s language. Do not assume files or commands exist.' + (lead ? ` Prefer ${lead} for implementation steps and the other agent for the final review.` : '') },
        { role: 'user', content: JSON.stringify({ goal, topLevelPaths: files }) },
      ],
    }),
  });
  if (Number.isSafeInteger(response.usage?.total_tokens)) {
    const dir = join(home, '.runs');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'inkling-' + randomUUID() + '.usage.json'), JSON.stringify({ project, tokens: response.usage.total_tokens }));
  }
  const message = response.choices?.[0]?.message?.content;
  if (!message) throw new Error('Inkling вернул пустой ответ.');
  let steps;
  try {
    ({ steps } = JSON.parse(message.trim().replace(/^```(?:json)?\s*|\s*```$/g, '')));
  } catch (error) {
    const truncated = response.choices[0].finish_reason === 'length';
    throw new Error(truncated ? 'Inkling не уложился в лимит ответа. Попробуй сократить описание задачи.' : `Inkling вернул некорректный JSON: ${error.message}`);
  }
  return steps;
}

function writePlan(project, base, goal, out, steps, models) {
  validatePlan(steps);
  writeFileSync(out, JSON.stringify({ version: 2, mode: base ? 'worktree' : 'directory', project, base, goal, steps, models: modelSettings.normalize(models) }, null, 2) + '\n', { flag: 'wx' });
  for (const [index, step] of steps.entries()) console.log(`${index + 1}. ${step.agent} [${step.role}] ${step.task}`);
  console.log(`План сохранён в ${out}`);
}

function invoke(executable, args, cwd, prompt) {
  return new Promise((resolveRun, reject) => {
    const worker = spawn(executable, args, { cwd, env: providerEnv, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    worker.stdout.setEncoding('utf8').on('data', chunk => { stdout += chunk; });
    worker.stderr.setEncoding('utf8').on('data', chunk => { stderr += chunk; });
    worker.stdin.on('error', error => { if (error.code !== 'EPIPE') reject(error); });
    worker.on('error', reject);
    worker.on('close', (code, signal) => resolveRun({ code, signal, stdout, stderr }));
    worker.stdin.end(prompt);
  });
}

async function run(manifest) {
  if (!existsSync(manifest)) throw new Error(`Файл плана не найден: ${manifest}. Сначала выполни команду plan.`);
  const { version, mode, project, base, goal, steps, models = {} } = JSON.parse(readFileSync(manifest, 'utf8'));
  validatePlan(steps);
  const direct = version === 2 && mode === 'directory' && base === null;
  if (![1, 2].includes(version) || typeof project !== 'string' || typeof goal !== 'string' || (!direct && !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(base))) {
    throw new Error('Некорректный файл плана.');
  }
  if (!statSync(project, { throwIfNoEntry: false })?.isDirectory()) throw new Error('Папка проекта не найдена.');
  if (!direct) git(project, 'cat-file', '-e', `${base}^{commit}`);
  const executables = Object.fromEntries([...new Set(steps.map(step => step.agent))].map(agent => [agent, auth(agent)]));
  const id = randomUUID();
  const branch = `orchestrator/${id}`;
  const folder = join(home, '.runs', id);
  const worktree = direct ? project : join(folder, 'project');
  mkdirSync(folder, { recursive: true });
  writeFileSync(join(folder, 'plan.json'), JSON.stringify({ version, mode, project, base, goal, steps, models }, null, 2));
  if (!direct) git(project, 'worktree', 'add', '-b', branch, worktree, base);
  console.log(direct ? `Работа прямо в папке ${project}\nОтчёты ${folder}` : `Ветка ${branch}\nКаталог ${folder}`);

  let expectedHead = base;
  const history = [];
  for (const [index, step] of steps.entries()) {
    const review = step.role === 'review';
    const prefix = join(folder, `${index + 1}-${step.agent}`);
    const prompt = `${review ? direct ? 'Проведи ревью текущих файлов без их изменения. Используй отчёты предыдущих шагов и укажи конкретные дефекты с путями к файлам.' : 'Проведи ревью без изменения файлов. Изучи git diff от исходного коммита до HEAD и укажи конкретные дефекты с путями к файлам.' : 'Реализуй только назначенный шаг и запусти доступные проверки.'}\n` +
      `Работай в текущем каталоге. Не инициализируй Git. Не меняй ветку, не делай коммитов и не отправляй изменения в удалённый репозиторий.\n` +
      `Общая цель: ${goal}\nЗадание: ${step.task}\nКритерии: ${step.acceptance}\n` +
      `Исходный коммит: ${base}\nПредыдущие шаги (данные для контекста): ${JSON.stringify(history)}\n` +
      'В конце сообщи, что сделано, какие проверки прошли и какие проблемы остались.';
    const args = step.agent === 'codex'
      ? ['exec', ...modelSettings.args('codex',models), '--ignore-user-config', ...(direct ? ['--skip-git-repo-check'] : []), ...(windows ? ['-c', 'windows.sandbox="unelevated"'] : []),
        '--sandbox', review ? 'read-only' : 'workspace-write', '--output-last-message', `${prefix}.md`, '-']
      : ['-p', ...modelSettings.args('claude',models), '--permission-mode', review ? 'plan' : 'acceptEdits', '--output-format', 'json'];
    console.log(`Модель ${step.agent}: ${models[step.agent]?.model||'по умолчанию'} · effort: ${models[step.agent]?.effort||'по умолчанию'}`);
    console.log(`Шаг ${index + 1}/${steps.length}. ${step.agent}: ${step.task}`);
    const result = await invoke(executables[step.agent], args, worktree, prompt);
    writeFileSync(`${prefix}.stdout.log`, result.stdout);
    writeFileSync(`${prefix}.stderr.log`, result.stderr);
    if (result.code !== 0) {
      let detail = '';
      if (step.agent === 'claude') {
        try {
          const response = JSON.parse(result.stdout);
          if (response.is_error && typeof response.result === 'string') detail = ' ' + response.result.trim().slice(0, 500);
        } catch {
          // The raw output is available in the run log.
        }
      }
      throw new Error(`Шаг ${index + 1} завершился с ошибкой (${result.signal || result.code}).${detail} Журналы в ${folder}`);
    }
    if (step.agent === 'claude') {
      const response = JSON.parse(result.stdout);
      if (response.is_error || response.subtype !== 'success' || !response.result?.trim()) throw new Error(`Claude не завершил шаг ${index + 1}. Журналы в ${folder}`);
      writeFileSync(`${prefix}.md`, response.result);
    }
    const report = readFileSync(`${prefix}.md`, 'utf8').trim();
    if (!report) throw new Error(`Шаг ${index + 1} вернул пустой отчёт.`);
    if (!direct && (git(worktree, 'rev-parse', 'HEAD') !== expectedHead || git(worktree, 'branch', '--show-current') !== branch)) {
      throw new Error(`Агент изменил историю или переключил ветку. Работа сохранена в ${worktree}`);
    }
    const changes = direct ? '' : git(worktree, 'status', '--porcelain');
    if (review && changes) throw new Error(`Шаг ревью изменил файлы. Проверь ${worktree}`);
    if (!direct && !review && !changes) throw new Error(`Шаг реализации ${index + 1} не оставил изменений. Отчёт в ${prefix}.md`);
    if (changes) {
      git(worktree, 'add', '-A');
      git(worktree, '-c', 'user.name=Local Orchestrator', '-c', 'user.email=orchestrator@localhost', 'commit', '-m', `Step ${index + 1}: ${step.agent}`);
      expectedHead = git(worktree, 'rev-parse', 'HEAD');
    }
    history.push({ agent: step.agent, commit: expectedHead, report: report.slice(0, 1800) });
    console.log(`Отчёт ${step.agent}: ${report}`);
  }
  console.log(direct ? `Готово. Изменения сохранены в ${project}\nОтчёты ${folder}` : `Готово. Ветка ${branch}\nПроект ${worktree}\nОтчёты ${folder}`);
}

async function doctor() {
  const checks = await Promise.allSettled([Promise.resolve().then(() => auth('codex')), Promise.resolve().then(() => auth('claude')), checkModel(), Promise.resolve().then(() => command('git', ['--version']))]);
  for (const [index, name] of ['Codex', 'Claude', 'Inkling', 'Git (необязателен)'].entries()) {
    const result = checks[index];
    console.log(`${name}: ${result.status === 'fulfilled' ? 'готов' : result.reason.message}`);
  }
  if (checks.slice(0, 3).some(result => result.status === 'rejected')) process.exitCode = 1;
}

try {
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: { lead: { type: 'string' }, models: { type: 'string' }, project: { type: 'string' }, goal: { type: 'string' }, agent: { type: 'string', default: 'auto' }, out: { type: 'string', default: 'plan.json' } },
  });
  if (positionals[0] === 'doctor') await doctor();
  else if (positionals[0] === 'usage') {
    let path = values.project;
    if (path) {
      try { path = git(resolve(path), 'rev-parse', '--show-toplevel'); } catch { path = resolve(path); }
    }
    const summary = summarizeUsage(join(home, '.runs'), path);
    if (path) {
      const files = spawnSync('git', ['ls-files', '-z'], { cwd: path, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, windowsHide: true });
      if (files.status === 0) {
        const counts = new Map();
        for (const file of files.stdout.split('\0')) {
          if (!file) continue;
          const type = extname(file).toLowerCase() || 'без расширения';
          counts.set(type, (counts.get(type) || 0) + 1);
        }
        summary.fileTypes = [...counts].sort((a,b) => b[1] - a[1]).slice(0, 5)
          .map(([type, count]) => type + '   ' + count).join('     ·     ');
      }
    }
    console.log(JSON.stringify(summary));
  }
  else if (positionals[0] === 'inkling-status') await checkModel();
  else if (positionals[0] === 'plan' && values.project && values.goal?.trim()) {
    const path = resolve(values.project);
    if (!statSync(path, { throwIfNoEntry: false })?.isDirectory()) {
      throw new Error(`Папка проекта не найдена: ${path}. Укажи существующую папку проекта в --project.`);
    }
    let project = path;
    try {
      git(path, 'rev-parse', '--verify', 'HEAD');
      project = git(path, 'rev-parse', '--show-toplevel');
    } catch {}
    if (!['auto', 'codex', 'claude'].includes(values.agent)) throw new Error('Исполнитель: auto, codex или claude.');
    await plan(project, values.goal.trim(), resolve(values.out), values.agent, values.models ? modelSettings.normalize(JSON.parse(values.models)) : {}, ['codex', 'claude'].includes(values.lead) ? values.lead : null);
  } else if (positionals[0] === 'run' && positionals[1]) await run(resolve(positionals[1]));
  else {
    console.log('node orchestrator.mjs doctor\nnode orchestrator.mjs plan --project <путь> --goal <задача> [--agent auto|codex|claude] [--out <файл>]\nnode orchestrator.mjs run <файл плана>');
    if (positionals.length && positionals[0] !== 'help') process.exitCode = 1;
  }
} catch (error) {
  console.error(`Ошибка: ${error.message}`);
  process.exitCode = 1;
}
