/**
 * Resolve the pinned Skills CLI (`skills@PINNED`) for direct node invocation.
 * Never uses `npx` or implicit latest package resolution.
 */

import * as fs from 'fs';
import { createRequire } from 'module';
import * as path from 'path';

import type { SkillsEnvironmentOptions, SkillsProcessEnv } from './env';
import { isWindowsSkillsEnvironment } from './env';
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
}

function findNodeExecutable(
  processEnv: SkillsProcessEnv,
  options?: SkillsEnvironmentOptions,
): string {
  const isWindows = isWindowsSkillsEnvironment(options);
  const execPath = options?.execPath ?? process.execPath;
  if (execPath && fs.existsSync(execPath)) {
    return execPath;
  }
  return isWindows ? 'node.exe' : 'node';
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

/**
 * Resolve the pinned skills CLI from known locations:
 * 1. Explicit override path (tests / composition)
 * 2. Plugin/vendor next to an injected plugin directory
 * 3. Node module resolution from process.cwd() / search paths
 */
export function resolvePinnedSkillsCli(options: {
  processEnv?: SkillsProcessEnv;
  environment?: SkillsEnvironmentOptions;
  vaultPath?: string | null;
  pluginDir?: string | null;
  overridePackageRoot?: string | null;
  searchPaths?: readonly string[];
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
  try {
    const require = createRequire(path.join(process.cwd(), 'package.json'));
    const pkgJson = require.resolve(`${PINNED_SKILLS_CLI_PACKAGE}/package.json`);
    candidates.push(path.dirname(pkgJson));
  } catch {
    // ignore
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

  throw new Error(
    `Pinned Skills CLI ${PINNED_SKILLS_CLI_PACKAGE}@${PINNED_SKILLS_CLI_VERSION} was not found. `
      + 'Install the exact lockfile dependency or bundle it with the plugin.',
  );
}
