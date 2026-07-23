#!/usr/bin/env node
/**
 * Deterministic real Obsidian/Electron lifecycle smoke for Pivi.
 *
 * Requires:
 * - `obsidian` CLI on PATH
 * - `.env.local` with OBSIDIAN_VAULT pointing at a development vault
 * - A recent `npm run build` deploy into that vault's plugin folder
 *
 * Proves: plugin load/reload, open view, disposable session create/restore,
 * disposable note mutation, fake stdio server start/stop with no leaked child,
 * unchanged window.fetch identity, and zero captured Obsidian runtime errors.
 */

import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay, clearTimeout as clearDelay } from 'node:timers';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const stamp = Date.now().toString(36);
const notePath = `.pivi-smoke/smoke-note-${stamp}.md`;
const sessionMarker = `pivi-smoke-session-${stamp}`;

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
  console.error(`smoke:obsidian FAILED: ${message}`);
  process.exit(1);
}

function runObsidian(args, options = {}) {
  const result = spawnSync('obsidian', args, {
    encoding: 'utf8',
    cwd: rootDir,
    env: process.env,
    ...options,
  });
  if (result.error) {
    fail(`obsidian ${args.join(' ')}: ${result.error.message}`);
  }
  if (typeof result.status === 'number' && result.status !== 0) {
    fail(
      `obsidian ${args.join(' ')} exited ${result.status}\n`
      + `${result.stdout || ''}\n${result.stderr || ''}`,
    );
  }
  return `${result.stdout || ''}${result.stderr || ''}`.trim();
}

function evalInObsidian(code) {
  const output = runObsidian(['eval', `code=${code}`]);
  const marker = '=> ';
  const idx = output.lastIndexOf(marker);
  if (idx < 0) {
    fail(`obsidian eval missing result marker:\n${output}`);
  }
  return output.slice(idx + marker.length).trim();
}

function isProcessAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function startFakeStdioServer() {
  const script = `
const net = require('node:net');
const server = net.createServer((socket) => {
  socket.on('data', () => {});
});
server.listen(0, '127.0.0.1', () => {
  process.stdout.write(JSON.stringify({ pid: process.pid, port: server.address().port }) + '\\n');
});
process.on('SIGTERM', () => { server.close(() => process.exit(0)); });
process.on('SIGINT', () => { server.close(() => process.exit(0)); });
`;
  const child = spawn(process.execPath, ['-e', script], {
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: process.platform !== 'win32',
  });
  return new Promise((resolve, reject) => {
    let buffer = '';
    const timer = delay(() => {
      child.kill('SIGTERM');
      reject(new Error('fake stdio server did not publish listen metadata'));
    }, 10_000);
    child.stdout.on('data', (chunk) => {
      buffer += chunk.toString('utf8');
      const line = buffer.split(/\r?\n/).find((entry) => entry.trim().startsWith('{'));
      if (!line) return;
      clearDelay(timer);
      try {
        const meta = JSON.parse(line);
        resolve({ child, pid: meta.pid, port: meta.port });
      } catch (error) {
        reject(error);
      }
    });
    child.on('error', (error) => {
      clearDelay(timer);
      reject(error);
    });
  });
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

  const which = spawnSync('obsidian', ['--help'], { encoding: 'utf8' });
  if (which.error || which.status !== 0) {
    fail('obsidian CLI is required on PATH');
  }

  console.log(`smoke:obsidian vault=${vaultPath}`);

  const fetchBefore = evalInObsidian(
    'JSON.stringify({ fetchName: String(window.fetch && window.fetch.name), fetchSame: window.fetch === fetch })',
  );
  const fetchBeforeJson = JSON.parse(fetchBefore);

  runObsidian(['plugin:reload', 'id=pivi']);
  runObsidian(['command', 'id=pivi:open-view']);

  const noteMutation = evalInObsidian(`(async () => {
    const folder = ".pivi-smoke";
    if (!(await app.vault.adapter.exists(folder))) {
      await app.vault.adapter.mkdir(folder);
    }
    const path = ${JSON.stringify(notePath)};
    await app.vault.adapter.write(path, "# Pivi smoke\\n\\ncreated=${stamp}\\n");
    await app.vault.adapter.append(path, "mutated=${stamp}\\n");
    const text = await app.vault.adapter.read(path);
    return JSON.stringify({ ok: text.includes("mutated=${stamp}"), path, bytes: text.length });
  })()`);
  const noteJson = JSON.parse(noteMutation);
  if (!noteJson.ok) {
    fail(`disposable note mutation did not persist: ${noteMutation}`);
  }

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
    fail(`expected sessionStore/processRunner on plugin: ${sessionProbe}`);
  }

  const sessionRelative = `.pivi/sessions/smoke-${stamp}.jsonl`;
  const sessionWrite = evalInObsidian(`(async () => {
    const relative = ${JSON.stringify(sessionRelative)};
    const dir = ".pivi/sessions";
    if (!(await app.vault.adapter.exists(".pivi"))) await app.vault.adapter.mkdir(".pivi");
    if (!(await app.vault.adapter.exists(dir))) await app.vault.adapter.mkdir(dir);
    const header = {
      type: "session",
      version: 3,
      id: ${JSON.stringify(sessionMarker)},
      timestamp: new Date().toISOString(),
      cwd: app.vault.adapter.basePath,
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

  const fake = await startFakeStdioServer();
  if (!isProcessAlive(fake.pid)) {
    fail(`fake stdio server exited early (pid ${fake.pid})`);
  }

  runObsidian(['plugin:reload', 'id=pivi']);
  runObsidian(['command', 'id=pivi:open-view']);

  try {
    fake.child.kill('SIGTERM');
  } catch {
    // best-effort; leak check below is authoritative
  }
  await new Promise((resolve) => {
    delay(resolve, 500);
  });
  if (isProcessAlive(fake.pid)) {
    try {
      process.kill(fake.pid, 'SIGKILL');
    } catch {
      // ignore
    }
    fail(`fake stdio server leaked after stop (pid ${fake.pid})`);
  }

  const fetchAfter = evalInObsidian(
    'JSON.stringify({ fetchName: String(window.fetch && window.fetch.name), fetchSame: window.fetch === fetch })',
  );
  const fetchAfterJson = JSON.parse(fetchAfter);
  if (!fetchAfterJson.fetchSame || !fetchBeforeJson.fetchSame) {
    fail(`window.fetch identity changed: before=${fetchBefore} after=${fetchAfter}`);
  }
  if (fetchAfterJson.fetchName !== fetchBeforeJson.fetchName) {
    fail(`window.fetch name changed: before=${fetchBefore} after=${fetchAfter}`);
  }

  const errors = runObsidian(['dev:errors']);
  if (!/No errors captured/i.test(errors)) {
    fail(`obsidian dev:errors reported runtime errors:\n${errors}`);
  }

  // Cleanup disposable artifacts through the vault adapter.
  evalInObsidian(`(async () => {
    try { await app.vault.adapter.remove(${JSON.stringify(notePath)}); } catch (_) {}
    try { await app.vault.adapter.remove(${JSON.stringify(sessionRelative)}); } catch (_) {}
    return JSON.stringify({ cleaned: true });
  })()`);

  console.log('smoke:obsidian OK');
  console.log(JSON.stringify({
    vaultPath,
    notePath,
    sessionRelative,
    fakeStdioPid: fake.pid,
    fakeStdioPort: fake.port,
    fetchName: fetchAfterJson.fetchName,
    host: os.platform(),
  }, null, 2));
}

main().catch((error) => {
  fail(error instanceof Error ? error.message : String(error));
});
