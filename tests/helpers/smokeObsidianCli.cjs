// CLI transport double; renderer expressions run against a temporary disk vault.
/* eslint-disable @typescript-eslint/no-require-imports -- Node --require preloads this CommonJS transport double before the ESM runner. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

if (require.main !== module) {
  const cp = require('node:child_process');
  const original = cp.spawnSync;
  cp.spawnSync = (binary, args, options) => {
    if (binary !== 'obsidian') return original(binary, args, options);
    fs.appendFileSync(process.env.SMOKE_CALLS, JSON.stringify({ args, cwd: options.cwd, timeout: options.timeout }) + '\n');
    if (process.env.SMOKE_CASE === 'timeout') return { error: new Error('ETIMEDOUT'), status: null };
    if (
      process.env.SMOKE_CASE === 'turn-timeout'
      && args.some(arg => arg.includes('"operation":"run"'))
    ) {
      original(process.execPath, [__filename, ...args], options);
      return { error: new Error('ETIMEDOUT'), status: null };
    }
    return original(process.execPath, [__filename, ...args], options);
  };
  require('node:module').syncBuiltinESMExports();
} else {
  run().catch(error => { process.stderr.write(error.message); process.exitCode = 1; });
}

async function run() {
  const scenario = process.env.SMOKE_CASE;
  const statePath = process.env.SMOKE_STATE;
  const state = fs.existsSync(statePath)
    ? JSON.parse(fs.readFileSync(statePath, 'utf8'))
    : { replaced: false, keys: [], snapshot: null };
  const originalFetch = function fetch() {};
  const replacementFetch = function fetch() {};
  const window = { fetch: state.replaced ? replacementFetch : originalFetch };
  for (const key of state.keys) window[key] = originalFetch;
  const fetch = window.fetch;
  const base = scenario === 'wrong-vault' ? process.env.SMOKE_OTHER : process.env.OBSIDIAN_VAULT;
  const adapter = {
    getBasePath: () => base,
    exists: async p => fs.existsSync(path.join(base, p)),
    read: async p => fs.readFileSync(path.join(base, p), 'utf8'),
    remove: async p => fs.unlinkSync(path.join(base, p)),
  };
  const development = scenario === 'current-shell' ? undefined : {
    runRealHostSmoke: request => runHarness(request, state, base, scenario),
  };
  const view = { getChatHandle: () => ({ development }) };
  const app = {
    vault: { adapter },
    commands: { executeCommandById: async () => true },
    workspace: { getLeavesOfType: () => [{ view }] },
  };
  const args = process.argv.slice(2);
  const command = args[1];
  if (command === 'help') { process.stdout.write('help'); return; }
  if (command === 'plugin:reload') {
    if (scenario === 'fetch-replacement') state.replaced = true;
  } else if (command === 'dev:errors') process.stdout.write('No errors captured.');
  else if (command === 'eval') {
    const code = args.find(arg => arg.startsWith('code=')).slice(5);
    const result = await vm.runInNewContext(code, { require, app, window, fetch, setTimeout });
    state.keys = Object.keys(window).filter(key => key.startsWith('pivi-smoke-fetch-'));
    process.stdout.write('=> ' + String(result));
  } else throw new Error('Unexpected command: ' + command);
  fs.writeFileSync(statePath, JSON.stringify(state));
}

async function runHarness(request, state, base, scenario) {
  const noteAbsolute = path.join(base, request.notePath);
  if (request.operation === 'run') {
    const sessionFile = `.pivi/sessions/smoke-${request.runId}.jsonl`;
    const sessionAbsolute = path.join(base, sessionFile);
    const user = `Pivi deterministic smoke turn: ${request.runId}`;
    const assistant = `Pivi smoke completed: ${request.runId}`;
    const noteContent = `# Pivi deterministic smoke\n\nrun=${request.runId}\n`;
    fs.writeFileSync(noteAbsolute, noteContent, { flag: 'wx' });
    fs.writeFileSync(sessionAbsolute, JSON.stringify({ runId: request.runId }), { flag: 'wx' });
    fs.writeFileSync(path.join(base, request.ledgerPath), JSON.stringify({
      version: 1,
      runId: request.runId,
      notePath: request.notePath,
      sessionFile,
      openSessionId: `open-${request.runId}`,
    }), { flag: 'wx' });
    if (scenario === 'write-failure') {
      fs.rmSync(sessionAbsolute, { force: true });
      fs.rmSync(noteAbsolute, { force: true });
      fs.rmSync(path.join(base, request.ledgerPath), { force: true });
      throw new Error('injected write failure');
    }
    state.snapshot = {
      version: 1,
      runId: request.runId,
      notePath: request.notePath,
      ledgerPath: request.ledgerPath,
      sessionFile,
      openSessionId: `open-${request.runId}`,
      noteContent,
      messages: [
        { role: 'user', content: user, toolCalls: [] },
        {
          role: 'assistant',
          content: assistant,
          toolCalls: [{
            id: `pivi-smoke-tool-${request.runId}`,
            name: 'write',
            status: 'completed',
            result: `Wrote ${request.notePath}`,
          }],
        },
      ],
    };
    return state.snapshot;
  }
  if (request.operation === 'inspect') {
    if (scenario === 'restore-failure') throw new Error('injected restore failure');
    return { ...state.snapshot, noteContent: fs.readFileSync(noteAbsolute, 'utf8') };
  }
  if (request.operation === 'cleanup') {
    fs.rmSync(path.join(base, request.sessionFile), { force: true });
    if (scenario === 'cleanup-failure') throw new Error('injected cleanup failure');
    fs.rmSync(noteAbsolute, { force: true });
    fs.rmSync(path.join(base, request.ledgerPath), { force: true });
    state.snapshot = null;
    return { version: 1, runId: request.runId, cleaned: true };
  }
  throw new Error('Unsupported smoke operation');
}

/* eslint-enable @typescript-eslint/no-require-imports -- End CommonJS preload exemption. */
