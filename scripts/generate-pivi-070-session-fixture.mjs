#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  copyFileSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const TAG = '0.7.0';
const TAG_COMMIT = 'f27ca3be149ecf4497f8d2e6ab8a236d14308c59';
const PI_DEPENDENCIES = Object.freeze({
  '@earendil-works/pi-agent-core': '0.80.6',
  '@earendil-works/pi-ai': '0.80.6',
  '@earendil-works/pi-coding-agent': '0.80.6',
});
const SYNTHETIC_VAULT = '/tmp/pivi-0.7.0-tag-generated-vault';
const FROZEN_FIXTURE_SHA256 = '3c191e3440fc1a95859ddb6a07687a74a2b5cc383062c0fab3b0c53e357ef67b';
const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function fail(message) {
  console.error(message);
  process.exit(1);
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: rootDir,
    encoding: 'utf8',
    ...options,
  });
  if (result.status !== 0) {
    throw new Error([
      `${command} ${args.join(' ')} failed with status ${result.status}`,
      result.stdout,
      result.stderr,
    ].filter(Boolean).join('\n'));
  }
  return result.stdout.trim();
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function packageVersion(lock, packageName) {
  return lock.packages?.[`node_modules/${packageName}`]?.version;
}

const outputArg = process.argv[2];
if (!outputArg) {
  fail('Usage: node scripts/generate-pivi-070-session-fixture.mjs <output-jsonl>');
}

const outputFile = resolve(outputArg);
const temporaryRoot = mkdtempSync(join(tmpdir(), 'pivi-0.7.0-source-'));
const worktreeRoot = join(temporaryRoot, 'source');
let worktreeAdded = false;
let ownsSyntheticVault = false;

try {
  const resolvedTag = run('git', ['rev-parse', `${TAG}^{commit}`]);
  if (resolvedTag !== TAG_COMMIT) {
    throw new Error(`Expected ${TAG} at ${TAG_COMMIT}, found ${resolvedTag}`);
  }

  const tagLock = JSON.parse(run('git', ['show', `${TAG_COMMIT}:package-lock.json`]));
  for (const [packageName, version] of Object.entries(PI_DEPENDENCIES)) {
    const locked = packageVersion(tagLock, packageName);
    if (locked !== version) {
      throw new Error(`${TAG} locks ${packageName}@${locked ?? 'missing'}, expected ${version}`);
    }
    const installed = JSON.parse(readFileSync(
      join(rootDir, 'node_modules', packageName, 'package.json'),
      'utf8',
    )).version;
    if (installed !== version) {
      throw new Error(`Installed ${packageName}@${installed}, expected ${version}`);
    }
  }

  run('git', ['worktree', 'add', '--detach', worktreeRoot, TAG_COMMIT]);
  worktreeAdded = true;
  const worktreeCommit = run('git', ['-C', worktreeRoot, 'rev-parse', 'HEAD']);
  if (worktreeCommit !== TAG_COMMIT) {
    throw new Error(`Temporary worktree resolved to ${worktreeCommit}`);
  }

  const rootNodeModules = join(rootDir, 'node_modules');
  const worktreeNodeModules = join(worktreeRoot, 'node_modules');
  if (existsSync(worktreeNodeModules)) {
    const linked = realpathSync(worktreeNodeModules);
    const expected = realpathSync(rootNodeModules);
    if (linked !== expected) {
      throw new Error(`Unexpected node_modules at ${worktreeNodeModules}`);
    }
  } else {
    symlinkSync(rootNodeModules, worktreeNodeModules, 'dir');
  }

  const preloadFile = join(worktreeRoot, 'pivi-0.7.0-deterministic-preload.mjs');
  writeFileSync(preloadFile, String.raw`
    import crypto from 'node:crypto';
    import { syncBuiltinESMExports } from 'node:module';

    const OriginalDate = Date;
    const fixedTime = OriginalDate.parse('2024-07-03T21:46:40.000Z');
    class FixedDate extends OriginalDate {
      constructor(...args) { super(...(args.length > 0 ? args : [fixedTime])); }
      static now() { return fixedTime; }
      toLocaleString() { return 'Jul 3, 09:46 PM'; }
    }
    globalThis.Date = FixedDate;

    let uuidCounter = 1;
    crypto.randomUUID = () => {
      const prefix = (uuidCounter++).toString(16).padStart(8, '0');
      return prefix + '-0000-4000-8000-000000000000';
    };
    syncBuiltinESMExports();
    Object.defineProperty(globalThis, 'crypto', {
      configurable: true,
      value: {
        getRandomValues(bytes) {
          bytes.fill(0x42);
          return bytes;
        },
      },
    });
  `);

  const generatorFile = join(
    worktreeRoot,
    'packages',
    'pivi-agent-core',
    'pivi-0.7.0-fixture-generator.ts',
  );
  writeFileSync(generatorFile, String.raw`
    import { readFileSync } from 'node:fs';
    import { PiSessionStore } from './src/engine/pi/session/piSessionStore';

    const vaultPath = process.argv[2];
    const store = new PiSessionStore({ delete: async () => undefined } as never, vaultPath);
    let ref = await store.create(vaultPath);
    await store.writeSessionMeta(ref, {
      title: 'Pivi 0.7.0 tag-generated fixture',
      titleSource: 'custom',
      createdAt: 1_720_047_600_000,
      lastResponseAt: 1_720_047_601_000,
    });
    await store.writeUiContext(ref, {
      currentNote: 'Synthetic/Provenance.md',
      externalContextPaths: ['/synthetic/pivi-0.7.0/session-context'],
      enabledMcpServers: ['synthetic-mcp'],
    });
    ref = await store.appendUserTurn(ref, 'Hello from the Pivi 0.7.0 writer.', {
      displayContent: 'Hello from the Pivi 0.7.0 writer.',
      turnRequest: {
        text: 'Hello from the Pivi 0.7.0 writer.',
        currentNotePath: 'Synthetic/Provenance.md',
        externalContextPaths: ['/synthetic/pivi-0.7.0/turn-context'],
      },
    });
    ref = await store.appendAgentTurn(ref, [
      { role: 'user', content: 'Hello from the Pivi 0.7.0 writer.', timestamp: 1_720_047_600_100 },
      {
        role: 'assistant',
        content: [{ type: 'text', text: 'Restored answer from the tag-generated fixture.' }],
        provider: 'openai',
        model: 'synthetic-model',
        api: 'openai-completions',
        usage: {
          input: 10,
          output: 8,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 18,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        },
        stopReason: 'stop',
        timestamp: 1_720_047_601_000,
      },
    ]);
    const absoluteFile = vaultPath + '/' + ref.sessionFile;
    process.stdout.write(JSON.stringify({
      absoluteFile,
      sessionFile: ref.sessionFile,
      sessionId: ref.sessionId,
      byteLength: readFileSync(absoluteFile).length,
    }));
  `);

  if (existsSync(SYNTHETIC_VAULT)) {
    throw new Error(`Refusing to replace existing synthetic vault path: ${SYNTHETIC_VAULT}`);
  }
  ownsSyntheticVault = true;
  const generated = JSON.parse(run(process.execPath, [
    '--import', preloadFile,
    '--import', 'tsx',
    generatorFile,
    SYNTHETIC_VAULT,
  ], {
    cwd: worktreeRoot,
    env: {
      ...process.env,
      LANG: 'en_US.UTF-8',
      LC_ALL: 'en_US.UTF-8',
      NODE_ENV: 'production',
      TZ: 'UTC',
    },
  }));

  const bytes = readFileSync(generated.absoluteFile);
  const text = bytes.toString('utf8');
  for (const machinePath of [rootDir, worktreeRoot, homedir()]) {
    if (machinePath && text.includes(machinePath)) {
      throw new Error(`Generated fixture leaked machine path: ${machinePath}`);
    }
  }
  if (!text.includes(SYNTHETIC_VAULT)
    || !text.includes('/synthetic/pivi-0.7.0/session-context')
    || !text.includes('/synthetic/pivi-0.7.0/turn-context')) {
    throw new Error('Generated fixture is missing its fixed synthetic provenance paths');
  }

  const digest = sha256(bytes);
  if (digest !== FROZEN_FIXTURE_SHA256) {
    throw new Error(`Generated SHA256 ${digest} does not match frozen ${FROZEN_FIXTURE_SHA256}`);
  }
  copyFileSync(generated.absoluteFile, outputFile);
  console.log(JSON.stringify({
    outputFile,
    byteLength: bytes.length,
    sha256: digest,
    tag: TAG,
    tagCommit: TAG_COMMIT,
    piDependencies: PI_DEPENDENCIES,
    syntheticVault: SYNTHETIC_VAULT,
  }, null, 2));
} finally {
  if (ownsSyntheticVault) {
    rmSync(SYNTHETIC_VAULT, { recursive: true, force: true });
  }
  if (worktreeAdded) {
    spawnSync('git', ['worktree', 'remove', '--force', worktreeRoot], {
      cwd: rootDir,
      encoding: 'utf8',
    });
  }
  rmSync(temporaryRoot, { recursive: true, force: true });
}
