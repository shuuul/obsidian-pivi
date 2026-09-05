#!/usr/bin/env node
/**
 * Deterministic real Obsidian/Electron lifecycle smoke for Pivi.
 *
 * Requires:
 * - `obsidian` CLI on PATH
 * - `.env.local` with OBSIDIAN_VAULT pointing at a development vault
 * - A recent `npm run build` deploy into that vault's plugin folder
 *
 * Transitional probe: the legacy service contract is checked before fixture
 * writes. Current lifecycle-only builds fail that check until spec 050's typed
 * harness replaces it. Raw fixture checks do not prove Pivi session recovery.
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
const sessionMarker = `pivi-smoke-session-${stamp}`;
const sessionRelative = `.pivi/sessions/smoke-${stamp}.jsonl`;
const fetchKey = `pivi-smoke-fetch-${stamp}`;
let targetVault;
let fetchReferenceAttempted = false;
const ownedFiles = [];

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
  runObsidian(['help']);
  evalInObsidian('true');

  console.log(`smoke:obsidian vault=${targetVault}`);

  const sessionProbe = evalInObsidian(`(() => {
    const plugin = app.plugins.plugins.pivi;
    if (!plugin) return JSON.stringify({ ok: false, error: 'pivi missing' });
    return JSON.stringify({
      ok: true,
      enabled: !!plugin._loaded,
      hasSessionStore: !!plugin.sessionStore,
      hasProcessRunner: !!plugin.processRunner,
      fetchSame: window.fetch === fetch,
      fetchName: String(window.fetch && window.fetch.name),
      marker: ${JSON.stringify(sessionMarker)},
    });
  })()`);
  const sessionJson = JSON.parse(sessionProbe);
  if (!sessionJson.ok || !sessionJson.enabled) {
    fail(`plugin load probe failed: ${sessionProbe}`);
  }
  if (!sessionJson.hasSessionStore || !sessionJson.hasProcessRunner) {
    fail('Legacy smoke contract unavailable; the replacement typed harness is pending in spec 050. No fixtures were written.');
  }

  fetchReferenceAttempted = true;
  evalInObsidian(`(() => {
    window[${JSON.stringify(fetchKey)}] = window.fetch;
    return true;
  })()`);
  evalInObsidian('true');
  runObsidian(['plugin:reload', 'id=pivi']);
  assertFetchIdentity();

  // Existing fixture directories are prerequisites, never owned by this run.
  // Creating shared directories and recursively deleting them on failure can
  // destroy files created by the user or another concurrent smoke run.
  for (const relative of [notePath, sessionRelative]) {
    const directory = path.join(targetVault, path.dirname(relative));
    if (!fs.statSync(directory).isDirectory()) {
      fail(`Missing fixture directory: ${path.dirname(relative)}`);
    }
    if (fs.realpathSync(directory) !== directory) fail('Fixture directory must not be a symlink');
    // Exclusive reservation establishes ownership before a renderer write can
    // partially fail. A collision must never be overwritten or cleaned up.
    fs.writeFileSync(path.join(targetVault, relative), '', { flag: 'wx' });
    ownedFiles.push(relative);
  }
  const noteMutation = evalInObsidian(`(async () => {
    const path = ${JSON.stringify(notePath)};
    await app.vault.adapter.write(path, "# Pivi smoke\\n\\ncreated=${stamp}\\n");
    await app.vault.adapter.append(path, "mutated=${stamp}\\n");
    const text = await app.vault.adapter.read(path);
    return JSON.stringify({ ok: text.includes("mutated=${stamp}"), path, bytes: text.length });
  })()`);
  if (!JSON.parse(noteMutation).ok) fail('Disposable note mutation did not persist');

  const sessionWrite = evalInObsidian(`(async () => {
    const relative = ${JSON.stringify(sessionRelative)};
    const header = {
      type: "session",
      version: 3,
      id: ${JSON.stringify(sessionMarker)},
      timestamp: new Date().toISOString(),
      cwd: app.vault.adapter.getBasePath(),
    };
    const userEntry = {
      type: "message",
      id: ${JSON.stringify(`user-${stamp}`)},
      parentId: null,
      timestamp: new Date().toISOString(),
      message: { role: "user", content: ${JSON.stringify(`smoke ${stamp}`)}, timestamp: Date.now() },
    };
    const body = JSON.stringify(header) + "\\n" + JSON.stringify(userEntry) + "\\n";
    await app.vault.adapter.write(relative, body);
    const text = await app.vault.adapter.read(relative);
    return JSON.stringify({
      ok: text.includes(${JSON.stringify(sessionMarker)}),
      bytes: text.length,
      fetchSame: window.fetch === fetch,
    });
  })()`);
  const restoreJson = JSON.parse(sessionWrite);
  if (!restoreJson.ok) {
    fail(`disposable session create/restore probe failed: ${sessionWrite}`);
  }

  evalInObsidian('true');
  runObsidian(['plugin:reload', 'id=pivi']);
  assertFetchIdentity();

  const errors = runObsidian(['dev:errors']);
  if (!/No errors captured/i.test(errors)) {
    fail(`obsidian dev:errors reported runtime errors:\n${errors}`);
  }

  return {
    vaultPath,
    notePath,
    sessionRelative,
    host: os.platform(),
  };
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
  for (const relative of ownedFiles) {
    try {
      evalInObsidian(`(async () => {
        const path = ${JSON.stringify(relative)};
        if (await app.vault.adapter.exists(path)) await app.vault.adapter.remove(path);
        return true;
      })()`);
    } catch (error) {
      failures.push(new Error(`Cleanup failed for owned fixture ${relative}`, { cause: error }));
    }
  }
  // No cleanup call to an unverified/missing host is needed before a reference
  // was installed; the key is unique and never contains user data.
  if (fetchReferenceAttempted) {
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
  console.log('smoke:obsidian legacy fixture probes OK (not Pivi recovery evidence)');
  console.log(JSON.stringify(result, null, 2));
}
