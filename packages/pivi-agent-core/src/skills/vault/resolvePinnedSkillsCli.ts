/**
 * Resolve the pinned Skills CLI (`skills@PINNED`) for direct node invocation.
 * Never uses `npx` or implicit latest package resolution.
 */

import * as fs from 'fs';
import { createRequire } from 'module';
import * as os from 'os';
import * as path from 'path';

import type { SkillsEnvironmentOptions, SkillsProcessEnv } from './env';
import { findNodeExecutable as resolveNodeExecutable } from './env';
import {
  PINNED_SKILLS_CLI_PACKAGE,
  PINNED_SKILLS_CLI_VERSION,
} from './skillsCliConstants';

export interface SkillsCliInvocation {
  /** Absolute path to the node executable. */
  executable: string;
  /** Absolute path to skills/bin/cli.mjs */
  cliPath: string;
  version: string;
  packageName: string;
  /** Removes a temporary materialized bundled CLI, when present. */
  cleanup?: () => void;
}

declare const __PIVI_EMBEDDED_SKILLS_CLI_BASE64__: string | undefined;

function findNodeExecutable(
  processEnv: SkillsProcessEnv,
  options?: SkillsEnvironmentOptions,
): string {
  return resolveNodeExecutable(undefined, processEnv, options);
}

function packageVersion(packageRoot: string): string | null {
  try {
    const raw = fs.readFileSync(path.join(packageRoot, 'package.json'), 'utf8');
    const parsed = JSON.parse(raw) as { name?: string; version?: string };
    if (parsed.name !== PINNED_SKILLS_CLI_PACKAGE) {
      return null;
    }
    return typeof parsed.version === 'string' ? parsed.version : null;
  } catch {
    return null;
  }
}

function cliPathFromPackageRoot(packageRoot: string): string | null {
  const candidate = path.join(packageRoot, 'bin', 'cli.mjs');
  return fs.existsSync(candidate) ? candidate : null;
}

function materializeEmbeddedCli(sourceBase64: string): Pick<SkillsCliInvocation, 'cliPath' | 'cleanup'> {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pivi-skills-cli-'));
  const binDir = path.join(tempRoot, 'bin');
  const distDir = path.join(tempRoot, 'dist');
  const cliPath = path.join(binDir, 'cli.mjs');
  try {
    fs.mkdirSync(binDir);
    fs.mkdirSync(distDir);
    fs.writeFileSync(
      path.join(tempRoot, 'package.json'),
      JSON.stringify({ name: PINNED_SKILLS_CLI_PACKAGE, version: PINNED_SKILLS_CLI_VERSION, type: 'module' }),
      { mode: 0o600 },
    );
    fs.writeFileSync(
      path.join(distDir, 'cli.mjs'),
      Buffer.from(sourceBase64, 'base64'),
      { mode: 0o600 },
    );
    fs.writeFileSync(cliPath, "await import('../dist/cli.mjs');\n", { mode: 0o600 });
  } catch (error) {
    fs.rmSync(tempRoot, { recursive: true, force: true });
    throw error;
  }
  return {
    cliPath,
    cleanup: () => fs.rmSync(tempRoot, { recursive: true, force: true }),
  };
}

/**
 * Resolve the pinned skills CLI from known locations:
 * 1. Explicit override path (tests / composition)
 * 2. Plugin/vendor next to an injected plugin directory
 * 3. Node module resolution from process.cwd() / search paths
 * 4. The exact dependency bundled into the plugin artifact
 */
export function resolvePinnedSkillsCli(options: {
  processEnv?: SkillsProcessEnv;
  environment?: SkillsEnvironmentOptions;
  vaultPath?: string | null;
  pluginDir?: string | null;
  overridePackageRoot?: string | null;
  searchPaths?: readonly string[];
  embeddedCliBase64?: string | null;
  resolveFromWorkspace?: boolean;
} = {}): SkillsCliInvocation {
  const processEnv = options.processEnv ?? process.env;
  const nodeExecutable = findNodeExecutable(processEnv, options.environment);
  const candidates: string[] = [];

  if (options.overridePackageRoot) {
    candidates.push(options.overridePackageRoot);
  }
  if (options.pluginDir) {
    candidates.push(path.join(options.pluginDir, 'vendor', 'skills'));
  }
  for (const search of options.searchPaths ?? []) {
    candidates.push(search);
  }

  // Dev / test: resolve from the workspace install.
  if (options.resolveFromWorkspace !== false) {
    try {
      const require = createRequire(path.join(process.cwd(), 'package.json'));
      const pkgJson = require.resolve(`${PINNED_SKILLS_CLI_PACKAGE}/package.json`);
      candidates.push(path.dirname(pkgJson));
    } catch {
      // ignore
    }
  }

  for (const root of candidates) {
    const version = packageVersion(root);
    if (version !== PINNED_SKILLS_CLI_VERSION) {
      continue;
    }
    const cliPath = cliPathFromPackageRoot(root);
    if (!cliPath) {
      continue;
    }
    return {
      executable: nodeExecutable,
      cliPath,
      version,
      packageName: PINNED_SKILLS_CLI_PACKAGE,
    };
  }

  const embeddedCliBase64 = options.embeddedCliBase64
    ?? (typeof __PIVI_EMBEDDED_SKILLS_CLI_BASE64__ === 'string'
      ? __PIVI_EMBEDDED_SKILLS_CLI_BASE64__
      : null);
  if (embeddedCliBase64) {
    return {
      executable: nodeExecutable,
      ...materializeEmbeddedCli(embeddedCliBase64),
      version: PINNED_SKILLS_CLI_VERSION,
      packageName: PINNED_SKILLS_CLI_PACKAGE,
    };
  }

  throw new Error(
    `Pinned Skills CLI ${PINNED_SKILLS_CLI_PACKAGE}@${PINNED_SKILLS_CLI_VERSION} was not found. `
      + 'Install the exact lockfile dependency or bundle it with the plugin.',
  );
}
