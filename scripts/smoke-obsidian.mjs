#!/usr/bin/env node
/**
 * Deterministic real Obsidian/Electron lifecycle smoke for Pivi.
 *
 * Requires:
 * - `obsidian` CLI on PATH
 * - `.env.local` with OBSIDIAN_VAULT pointing at a development vault
 * - A current `npm run dev` development build deployed into that vault
 *
 * The development build exposes a versioned semantic harness through the
 * mounted Pivi view. The harness drives the real runtime, session store, tool
 * registry, and Obsidian vault adapter with a deterministic local provider.
 */

import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const stamp = randomUUID();
const notePath = `.pivi-smoke/smoke-note-${stamp}.md`;
const ledgerPath = `.pivi-smoke/smoke-ledger-${stamp}.json`;
const fetchKey = `pivi-smoke-fetch-${stamp}`;
let targetVault;
let fetchReferenceAttempted = false;
let smokeSnapshot;
let rendererOutcomeUnknown = false;

function loadEnvLocal() {
  const envPath = path.join(rootDir, '.env.local');
  if (!fs.existsSync(envPath)) {
    return {};
  }
  const values = {};
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    values[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim();
  }
  return values;
}

function fail(message) {
  throw new Error(message);
}

function runObsidian(args) {
  const result = spawnSync('obsidian', [`vault=${path.basename(targetVault)}`, ...args], {
    encoding: 'utf8',
    cwd: targetVault,
    env: process.env,
    timeout: 30_000,
  });
  if (result.error) {
    rendererOutcomeUnknown = true;
    fail(`obsidian ${args.join(' ')}: ${result.error.message}`);
  }
  if (result.status !== 0) {
    fail(
      `obsidian ${args.join(' ')} exited ${result.status}\n`
      + `${result.stdout || ''}\n${result.stderr || ''}`,
    );
  }
  return `${result.stdout || ''}${result.stderr || ''}`.trim();
}

function evalInObsidian(code) {
  // Every renderer operation checks its destination, including cleanup after a
  // reload. A same-name vault or changed CLI target must not receive writes.
  const guarded = `(async () => {
    const actual = require('fs').realpathSync(app.vault.adapter.getBasePath());
    if (actual !== ${JSON.stringify(targetVault)}) throw new Error('Smoke vault mismatch');
    return await (${code});
  })()`;
  const output = runObsidian(['eval', `code=${guarded}`]);
  const marker = '=> ';
  const idx = output.lastIndexOf(marker);
  if (idx < 0) {
    fail(`obsidian eval missing result marker:\n${output}`);
  }
  return output.slice(idx + marker.length).trim();
}

async function main() {
  const envLocal = loadEnvLocal();
  const vaultPath = process.env.OBSIDIAN_VAULT || envLocal.OBSIDIAN_VAULT;
  if (!vaultPath) {
    fail('OBSIDIAN_VAULT is required in the environment or .env.local');
  }
  if (!fs.existsSync(vaultPath)) {
    fail(`OBSIDIAN_VAULT does not exist: ${vaultPath}`);
  }

  targetVault = fs.realpathSync(vaultPath);
  if (!fs.statSync(targetVault).isDirectory()) fail('OBSIDIAN_VAULT must be a directory');
  const fixtureDirectory = path.join(targetVault, '.pivi-smoke');
  if (!fs.existsSync(fixtureDirectory) || !fs.statSync(fixtureDirectory).isDirectory()) {
    fail('Missing fixture directory: .pivi-smoke');
  }
  if (fs.realpathSync(fixtureDirectory) !== fixtureDirectory) {
    fail('Fixture directory must not be a symlink');
  }
  runObsidian(['help']);
  evalInObsidian('true');

  console.log(`smoke:obsidian vault=${targetVault}`);

  fetchReferenceAttempted = true;
  evalInObsidian(`(() => {
    window[${JSON.stringify(fetchKey)}] = window.fetch;
    return true;
  })()`);
  evalInObsidian('true');
  runObsidian(['plugin:reload', 'id=pivi']);
  assertFetchIdentity();
  smokeSnapshot = runHarness({
    version: 1,
    operation: 'run',
    runId: stamp,
    notePath,
    ledgerPath,
  });
  assertSmokeSnapshot(smokeSnapshot);

  evalInObsidian('true');
  runObsidian(['plugin:reload', 'id=pivi']);
  assertFetchIdentity();
  const restored = runHarness({
    version: 1,
    operation: 'inspect',
    runId: stamp,
    notePath,
    ledgerPath,
    sessionFile: smokeSnapshot.sessionFile,
  });
  assertSmokeSnapshot(restored);
  if (JSON.stringify(restored.messages) !== JSON.stringify(smokeSnapshot.messages)) {
    fail('Durable session semantics changed across plugin reload');
  }

  const errors = runObsidian(['dev:errors']);
  if (!/No errors captured/i.test(errors)) {
    fail(`obsidian dev:errors reported runtime errors:\n${errors}`);
  }

  return {
    vaultPath,
    notePath,
    sessionFile: smokeSnapshot.sessionFile,
    host: os.platform(),
  };
}

function runHarness(request) {
  const output = evalInObsidian(`(async () => {
    await app.commands.executeCommandById('pivi:open-view');
    const deadline = Date.now() + 10000;
    let handle;
    while (Date.now() < deadline) {
      const view = app.workspace.getLeavesOfType('pivi-view')[0]?.view;
      handle = view?.getChatHandle?.();
      if (handle?.development?.runRealHostSmoke) break;
      await new Promise(resolve => setTimeout(resolve, 25));
    }
    if (!handle?.development?.runRealHostSmoke) {
      throw new Error('Development smoke harness unavailable; deploy a development build.');
    }
    return JSON.stringify(await handle.development.runRealHostSmoke(${JSON.stringify(request)}));
  })()`);
  return JSON.parse(output);
}

function assertSmokeSnapshot(snapshot) {
  const expectedUser = `Pivi deterministic smoke turn: ${stamp}`;
  const expectedAssistant = `Pivi smoke completed: ${stamp}`;
  const expectedNote = `# Pivi deterministic smoke\n\nrun=${stamp}\n`;
  if (snapshot.version !== 1 || snapshot.runId !== stamp || snapshot.noteContent !== expectedNote) {
    fail(`Smoke snapshot identity or note mismatch: ${JSON.stringify(snapshot)}`);
  }
  if (snapshot.messages.map(message => message.role).join(',') !== 'user,assistant') {
    fail(`Smoke session roles mismatch: ${JSON.stringify(snapshot.messages)}`);
  }
  if (snapshot.messages[0]?.content !== expectedUser || snapshot.messages[1]?.content !== expectedAssistant) {
    fail(`Smoke session content mismatch: ${JSON.stringify(snapshot.messages)}`);
  }
  const tool = snapshot.messages[1]?.toolCalls?.find(call => call.name === 'obsidian_write');
  if (!tool || tool.status !== 'completed' || !tool.result.includes(`Wrote ${notePath}`)) {
    fail(`Smoke tool result mismatch: ${JSON.stringify(snapshot.messages)}`);
  }
}

function assertFetchIdentity() {
  if (evalInObsidian(`window[${JSON.stringify(fetchKey)}] === window.fetch`) !== 'true') {
    fail('window.fetch identity changed across plugin reload');
  }
}

let result;
const failures = [];
try {
  result = await main();
} catch (error) {
  failures.push(error);
} finally {
  if (smokeSnapshot?.sessionFile && !rendererOutcomeUnknown) {
    try {
      runHarness({
        version: 1,
        operation: 'cleanup',
        runId: stamp,
        notePath,
        ledgerPath,
        sessionFile: smokeSnapshot.sessionFile,
        openSessionId: smokeSnapshot.openSessionId,
      });
    } catch (error) {
      failures.push(new Error('Cleanup failed for real-host smoke resources', { cause: error }));
    }
  } else if (rendererOutcomeUnknown && targetVault && fs.existsSync(path.join(targetVault, ledgerPath))) {
    console.error(`smoke:obsidian retained ownership ledger for retry: ${ledgerPath}`);
  }
  // No cleanup call to an unverified/missing host is needed before a reference
  // was installed; the key is unique and never contains user data.
  if (fetchReferenceAttempted && !rendererOutcomeUnknown) {
    try {
      evalInObsidian(`delete window[${JSON.stringify(fetchKey)}]`);
    } catch (error) {
      failures.push(new Error('Cleanup failed for fetch reference', { cause: error }));
    }
  }
}
if (failures.length > 0) {
  for (const error of failures) console.error('smoke:obsidian FAILED:', error);
  process.exitCode = 1;
} else {
  console.log('smoke:obsidian deterministic Pivi turn/reload/restore OK');
  console.log(JSON.stringify(result, null, 2));
}
