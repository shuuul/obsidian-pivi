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
    return original(process.execPath, [__filename, ...args], options);
  };
  require('node:module').syncBuiltinESMExports();
} else {
  run().catch(error => { process.stderr.write(error.message); process.exitCode = 1; });
}

async function run() {
  const scenario = process.env.SMOKE_CASE;
  const statePath = process.env.SMOKE_STATE;
  const state = fs.existsSync(statePath) ? JSON.parse(fs.readFileSync(statePath, 'utf8')) : { replaced: false, keys: [] };
  const originalFetch = function fetch() {};
  const replacementFetch = function fetch() {};
  const window = { fetch: state.replaced ? replacementFetch : originalFetch };
  for (const key of state.keys) window[key] = originalFetch;
  const fetch = window.fetch;
  const base = scenario === 'wrong-vault' ? process.env.SMOKE_OTHER : process.env.OBSIDIAN_VAULT;
  const adapter = {
    getBasePath: () => base,
    exists: async p => fs.existsSync(path.join(base, p)),
    write: async (p, text) => {
      fs.writeFileSync(path.join(base, p), text);
      if (scenario === 'write-failure' || scenario === 'cleanup-failure') throw new Error('injected write failure');
    },
    append: async (p, text) => fs.appendFileSync(path.join(base, p), text),
    read: async p => fs.readFileSync(path.join(base, p), 'utf8'),
    remove: async p => {
      if (scenario === 'cleanup-failure' && p.endsWith('.md')) throw new Error('injected remove failure');
      fs.unlinkSync(path.join(base, p));
    },
  };
  const plugin = scenario === 'current-shell' ? { _loaded: true } : { _loaded: true, sessionStore: {}, processRunner: {} };
  const app = { vault: { adapter }, plugins: { plugins: { pivi: plugin } } };
  const args = process.argv.slice(2);
  const command = args[1];
  if (command === 'help') { process.stdout.write('help'); return; }
  if (command === 'plugin:reload') {
    if (scenario === 'fetch-replacement') state.replaced = true;
  } else if (command === 'dev:errors') process.stdout.write('No errors captured.');
  else if (command === 'eval') {
    const result = await vm.runInNewContext(args.find(a => a.startsWith('code=')).slice(5), { require, app, window, fetch });
    state.keys = Object.keys(window).filter(key => key.startsWith('pivi-smoke-fetch-'));
    process.stdout.write('=> ' + String(result));
  } else throw new Error('Unexpected command: ' + command);
  fs.writeFileSync(statePath, JSON.stringify(state));
}

/* eslint-enable @typescript-eslint/no-require-imports -- End CommonJS preload exemption. */
