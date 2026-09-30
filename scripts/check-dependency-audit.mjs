#!/usr/bin/env node
/**
 * Dependency audit gate: fail on every known npm advisory except those an
 * explicit, expiring allowlist entry accepts for one exact install path.
 *
 * Plain `npm audit` cannot be satisfied when an advisory sits inside a
 * dependency's own npm-shrinkwrap.json: npm ignores root overrides there, so
 * only an upstream release can move the pin. Each accepted entry names the
 * advisory, the install path, the reason, and an expiry so the exception is
 * re-reviewed instead of silently outliving the upstream fix.
 */

import { execFileSync } from 'child_process';
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const ALLOWLIST_PATH = join(__dirname, 'dependency-audit-allowlist.json');

function advisoryId(via) {
  const match = typeof via.url === 'string' ? via.url.match(/GHSA-[\w-]+$/) : null;
  return match ? match[0] : String(via.source);
}

/**
 * Evaluate an `npm audit --json` report. Transitive entries (string `via`)
 * only point at a package whose own entry carries the advisory, so direct
 * advisories at their install paths are the complete set to judge.
 */
function evaluateAudit(report, allowlist, now = new Date()) {
  const failures = [];
  const accepted = [];
  const used = new Set();

  for (const [name, vulnerability] of Object.entries(report.vulnerabilities ?? {})) {
    const advisories = (vulnerability.via ?? []).filter((via) => typeof via === 'object' && via !== null);
    for (const via of advisories) {
      const id = advisoryId(via);
      for (const node of vulnerability.nodes ?? []) {
        const entryIndex = allowlist.findIndex((entry) => (
          entry.advisory === id && entry.package === name && entry.path === node
        ));
        const entry = allowlist[entryIndex];
        const finding = `${id} ${name} at ${node} (${vulnerability.severity}): ${via.title ?? via.url ?? ''}`;
        if (!entry) {
          failures.push(finding);
          continue;
        }
        used.add(entryIndex);
        if (!(new Date(`${entry.expires}T23:59:59Z`) >= now)) {
          failures.push(`${finding} — allowlist entry expired on ${entry.expires}`);
          continue;
        }
        accepted.push(`${finding} — accepted until ${entry.expires}: ${entry.reason}`);
      }
    }
  }

  allowlist.forEach((entry, index) => {
    if (!used.has(index)) {
      failures.push(`Stale allowlist entry ${entry.advisory} ${entry.package} at ${entry.path}: remove it from scripts/dependency-audit-allowlist.json`);
    }
  });

  return { failures, accepted };
}

function runNpmAudit() {
  try {
    return execFileSync('npm', ['audit', '--json'], { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  } catch (error) {
    // npm audit exits non-zero whenever it finds advisories; the JSON report is still on stdout.
    if (error && typeof error.stdout === 'string' && error.stdout.trim()) return error.stdout;
    throw error;
  }
}

function checkDependencyAudit() {
  const report = JSON.parse(runNpmAudit());
  if (report.error) {
    console.error(`Dependency audit failed to run: ${report.error.summary ?? JSON.stringify(report.error)}`);
    process.exit(1);
  }
  const allowlist = JSON.parse(readFileSync(ALLOWLIST_PATH, 'utf8'));
  const { failures, accepted } = evaluateAudit(report, allowlist);
  for (const line of accepted) console.log(`Accepted: ${line}`);
  if (failures.length > 0) {
    for (const line of failures) console.error(`Rejected: ${line}`);
    console.error(`Dependency audit failed: ${failures.length} unaccepted finding(s).`);
    process.exit(1);
  }
  console.log('Dependency audit passed.');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  checkDependencyAudit();
}

export { evaluateAudit };
