import { tokenizeBashArgv, tokenizeCmdArgv } from './bashArgv';
import {
  isPosixCompatibleShell,
  isWindowsCmdShell,
  normalizeBashCommand,
} from './bashAuthorization';
import { splitPersistableShellComponents } from './bashCompoundSplit';
import {
  BASH_CLASSIFIER_VERSION,
  type BashClassification,
  type BashClassificationOptions,
  type BashExecutableResolver,
  type BashScopeRisk,
  type ClassifiedBashComponent,
  createBareNameResolver,
  defaultCaseInsensitiveExecutables,
  formatBashPermissionLabel,
  isPathExecutableToken,
  matchPersistentBashPermissions,
  normalizeExecutableName,
  normalizeSubcommand,
  type PersistentBashPermission,
} from './capabilityPermissions';

export { BASH_CLASSIFIER_VERSION };

/**
 * Persistent Bash scope standard.
 *
 * Factory Auto-run uses Off/Low/Medium/High plus glob allow/deny/block lists
 * (`npm *`) and resolves the invoked program before matching. Pivi keeps the
 * resolve-then-match rule and a hard Allow-once path for unresolved syntax, but
 * does not import autonomy levels or glob prefixes.
 *
 * Durable grants are structured identities, never invocation data:
 * 1. Resolve the invoked executable after stripping reviewed wrappers (`env`,
 *    `command`). Unrecognized wrappers, `shell -c` bodies, redirects, and
 *    substitutions are Allow once only.
 * 2. Persist `[exe]` or `[exe, token]`. Paths, URLs, package names, patterns,
 *    and script bodies never enter storage.
 * 3. The second token is a durable family verb from this registry
 *    (`git status`, `uv python`, `pixi global`), not a third-level operand
 *    (`uv python install`, `pixi global install cowsay`).
 * 4. Risk is a warning (and migration disable), not a fourth duration.
 */

const UNRECOGNIZED_WRAPPERS = new Set([
  'sudo', 'doas', 'nice', 'nohup', 'timeout', 'time', 'stdbuf', 'unbuffer',
  'watch', 'xargs', 'strace', 'lldb', 'gdb', 'script', 'su', 'pkexec',
]);

const SINGLE_PURPOSE = new Set([
  'grep', 'egrep', 'fgrep', 'rg', 'ripgrep', 'ag', 'ack',
  'ls', 'dir', 'wc', 'cat', 'tac', 'head', 'tail', 'less', 'more',
  'find', 'which', 'type', 'pwd', 'where', 'echo', 'printf', 'true', 'false',
  'date', 'uname', 'hostname', 'whoami', 'id', 'sort', 'uniq', 'cut', 'tr',
  'file', 'stat', 'du', 'df', 'sleep', 'basename', 'dirname', 'realpath',
  'readlink', 'md5', 'md5sum', 'sha256sum', 'shasum', 'jq', 'sed', 'tee',
  'cmp', 'diff', 'gzip', 'gunzip', 'xz', 'mkdir', 'rmdir', 'cp', 'mv', 'rm',
  'touch', 'chmod', 'ln', 'open', 'bat', 'fd', 'tree', 'hexdump', 'od',
  'nl', 'seq', 'yes', 'column', 'paste',
]);

const GIT_SUBCOMMANDS = new Set([
  'status', 'commit', 'add', 'log', 'diff', 'push', 'pull', 'fetch', 'clone',
  'checkout', 'branch', 'stash', 'merge', 'rebase', 'reset', 'show', 'blame',
  'tag', 'remote', 'config', 'init', 'mv', 'rm', 'grep', 'switch', 'restore',
  'cherry-pick', 'revert', 'bisect', 'worktree', 'submodule', 'describe',
  'shortlog', 'reflog', 'clean', 'notes', 'archive', 'bundle', 'fsck', 'gc',
  'rev-parse', 'rev-list', 'cat-file', 'ls-files', 'ls-tree', 'apply', 'am',
  'format-patch', 'sparse-checkout',
]);

const OBSIDIAN_SUBCOMMANDS = new Set([
  'eval', 'search', 'create', 'open', 'daily', 'tasks', 'history', 'plugin',
  'help', 'version', 'base',
]);

const NPM_SUBCOMMANDS = new Set([
  'run', 'test', 'install', 'ci', 'exec', 'init', 'publish', 'pack', 'link',
  'unlink', 'outdated', 'update', 'audit', 'start', 'stop', 'restart',
  'version', 'config', 'cache', 'root', 'bin', 'ls', 'list', 'view', 'info',
]);

const YARN_SUBCOMMANDS = new Set([
  'run', 'test', 'install', 'add', 'remove', 'exec', 'dlx', 'init', 'publish',
  'start', 'workspace', 'workspaces',
]);

const PNPM_SUBCOMMANDS = new Set([
  'run', 'test', 'install', 'add', 'remove', 'exec', 'dlx', 'init', 'publish',
  'start', 'outdated', 'update',
]);

const CARGO_SUBCOMMANDS = new Set([
  'build', 'run', 'test', 'check', 'clippy', 'fmt', 'add', 'remove', 'install',
  'update', 'search', 'tree', 'doc', 'bench', 'clean', 'new', 'init',
]);

const GO_SUBCOMMANDS = new Set([
  'build', 'run', 'test', 'mod', 'get', 'install', 'fmt', 'vet', 'env', 'list',
]);

const UV_SUBCOMMANDS = new Set([
  'run', 'x', 'pip', 'tool', 'python', 'add', 'remove', 'sync', 'lock', 'tree',
  'init', 'venv', 'build', 'publish', 'version', 'export', 'cache', 'clean',
  'self', 'format',
]);

const PIXI_SUBCOMMANDS = new Set([
  'add', 'auth', 'build', 'clean', 'config', 'exec', 'global', 'info', 'init',
  'install', 'list', 'lock', 'project', 'remove', 'run', 'search', 'self-update',
  'shell', 'shell-hook', 'task', 'tree', 'update', 'upgrade', 'upload', 'workspace',
]);

const MULTI_COMMANDS: Record<string, ReadonlySet<string>> = {
  git: GIT_SUBCOMMANDS,
  obsidian: OBSIDIAN_SUBCOMMANDS,
  npm: NPM_SUBCOMMANDS,
  yarn: YARN_SUBCOMMANDS,
  pnpm: PNPM_SUBCOMMANDS,
  cargo: CARGO_SUBCOMMANDS,
  go: GO_SUBCOMMANDS,
  uv: UV_SUBCOMMANDS,
  pixi: PIXI_SUBCOMMANDS,
};

const INTERPRETER_FLAGS: Record<string, readonly string[]> = {
  python: ['-c', '-m'],
  python2: ['-c', '-m'],
  python3: ['-c', '-m'],
  pypy: ['-c', '-m'],
  pypy3: ['-c', '-m'],
  node: ['-e', '-p', '-c'],
  nodejs: ['-e', '-p', '-c'],
  ruby: ['-e'],
  perl: ['-e', '-E'],
  php: ['-r'],
  lua: ['-e'],
  osascript: ['-e'],
  deno: ['eval'],
  bun: ['-e'],
};

const SHELL_FLAGS: Record<string, readonly string[]> = {
  sh: ['-c'],
  bash: ['-c'],
  zsh: ['-c'],
  dash: ['-c'],
  ksh: ['-c'],
  ksh93: ['-c'],
  fish: ['-c'],
  pwsh: ['-Command', '-c', '-EncodedCommand'],
  powershell: ['-Command', '-c', '-EncodedCommand'],
};

const PACKAGE_RUNNER_TARGETS = new Set(['npx', 'pnpx', 'bunx', 'uvx']);
const PACKAGE_RUNNER_OPERATIONS: Record<string, ReadonlySet<string>> = {
  pipx: new Set(['run']),
};

const HIGH_RISK_NAMES = new Set([
  ...Object.keys(INTERPRETER_FLAGS),
  ...Object.keys(SHELL_FLAGS),
  ...PACKAGE_RUNNER_TARGETS,
  ...Object.keys(PACKAGE_RUNNER_OPERATIONS),
  'uv',
  'pixi',
  'cmd',
]);

const EVALUATOR_SUBCOMMANDS: Record<string, ReadonlySet<string>> = {
  obsidian: new Set(['eval']),
};

const EXECUTOR_SUBCOMMANDS: Record<string, ReadonlySet<string>> = {
  uv: new Set(['run', 'x', 'tool']),
  pixi: new Set(['run', 'exec', 'shell']),
};

export function looksLikeLegacyBashEncoding(input: string): boolean {
  const trimmed = input.trim();
  return trimmed.startsWith('exact:') || trimmed.startsWith('prefix:');
}

export function isHighRiskBashPermission(permission: PersistentBashPermission): boolean {
  const name = permission.executable.kind === 'name'
    ? permission.executable.value
    : permission.executable.value.replaceAll('\\', '/').split('/').pop() ?? '';
  const normalized = name.replace(/\.(exe|cmd|bat)$/i, '').toLowerCase();
  if (!SINGLE_PURPOSE.has(normalized) && !(normalized in MULTI_COMMANDS) && !HIGH_RISK_NAMES.has(normalized)) {
    return true;
  }
  if (HIGH_RISK_NAMES.has(normalized)) return true;
  if (permission.kind === 'subcommand') {
    const evaluators = EVALUATOR_SUBCOMMANDS[normalized];
    if (evaluators?.has(permission.subcommand.toLowerCase())) return true;
  }
  return false;
}

export function classifyBashCommand(
  command: string,
  options: BashClassificationOptions = {},
): BashClassification {
  const trimmed = normalizeBashCommand(command);
  if (!trimmed) return { persistable: false, reason: 'empty' };
  if (looksLikeLegacyBashEncoding(trimmed)) {
    return { persistable: false, reason: 'legacy-encoding' };
  }

  const shellPath = options.shellPath ?? '/bin/sh';
  if (!isPosixCompatibleShell(shellPath) && !isWindowsCmdShell(shellPath)) {
    return { persistable: false, reason: 'unsafe-syntax' };
  }

  const split = splitPersistableShellComponents(trimmed, shellPath);
  if (!split.ok) return { persistable: false, reason: 'unsafe-syntax' };

  const caseInsensitive = options.caseInsensitive ?? defaultCaseInsensitiveExecutables(shellPath);
  const resolver = options.resolver ?? createBareNameResolver(caseInsensitive);
  const components: ClassifiedBashComponent[] = [];
  const seen = new Set<string>();

  for (const component of split.components) {
    const classified = classifyComponent(component, shellPath, resolver, caseInsensitive);
    if (classified === 'unsafe') return { persistable: false, reason: 'unsafe-syntax' };
    if (classified === 'unresolved') return { persistable: false, reason: 'unresolved-relative' };
    const key = classified.displayLabel;
    if (seen.has(key)) continue;
    seen.add(key);
    components.push(classified);
  }

  if (components.length === 0) return { persistable: false, reason: 'empty' };
  return { persistable: true, components };
}

export function matchBashPermissions(
  command: string,
  permissions: readonly PersistentBashPermission[],
  options: BashClassificationOptions = {},
): boolean {
  return matchPersistentBashPermissions(command, permissions, {
    ...options,
    classify: classifyBashCommand,
  });
}

function classifyComponent(
  command: string,
  shellPath: string,
  resolver: BashExecutableResolver,
  caseInsensitive: boolean,
): ClassifiedBashComponent | 'unsafe' | 'unresolved' {
  let argv: string[];
  try {
    argv = isWindowsCmdShell(shellPath)
      ? tokenizeCmdArgv(command)
      : tokenizeBashArgv(command);
  } catch {
    return 'unsafe';
  }
  const unwrapped = stripTransparentWrappers(argv, caseInsensitive);
  if (unwrapped === 'unsafe') return 'unsafe';
  if (unwrapped.length === 0) return 'unsafe';

  const exeToken = unwrapped[0]!;
  const resolved = resolver.resolve(exeToken);
  if (resolved === 'unresolved') return 'unresolved';

  const name = resolved.kind === 'name'
    ? resolved.value
    : normalizeExecutableName(resolved.value, caseInsensitive);
  const rest = unwrapped.slice(1);

  if (UNRECOGNIZED_WRAPPERS.has(name)) return 'unsafe';

  const interpreterFlags = INTERPRETER_FLAGS[name];
  if (interpreterFlags) {
    const flag = firstMatchingFlag(rest, interpreterFlags);
    if (flag) {
      return componentFor(resolved, flag, 'high', true);
    }
    return componentFor(resolved, null, 'high', false);
  }

  const shellFlags = SHELL_FLAGS[name];
  if (shellFlags) {
    const flag = firstMatchingFlag(rest, shellFlags);
    if (flag) {
      return componentFor(resolved, flag, 'high', true);
    }
    return componentFor(resolved, null, 'high', false);
  }

  const operations = PACKAGE_RUNNER_OPERATIONS[name];
  if (operations) {
    const operation = firstNonFlag(rest);
    if (operation && operations.has(normalizeSubcommand(operation, true))) {
      return componentFor(resolved, normalizeSubcommand(operation, caseInsensitive), 'executor', true);
    }
    return componentFor(resolved, null, 'executor', false);
  }

  if (PACKAGE_RUNNER_TARGETS.has(name)) {
    const target = firstNonFlag(rest);
    if (target && !isPathExecutableToken(target) && !looksLikeInvocationData(target)) {
      return componentFor(resolved, normalizeSubcommand(target, caseInsensitive), 'executor', true);
    }
    return componentFor(resolved, null, 'executor', false);
  }

  const subcommands = MULTI_COMMANDS[name];
  if (subcommands) {
    const sub = firstNonFlag(rest);
    if (sub && subcommands.has(normalizeSubcommand(sub, true)) && !looksLikeInvocationData(sub)) {
      const normalizedSub = normalizeSubcommand(sub, caseInsensitive);
      return componentFor(resolved, normalizedSub, subcommandRisk(name, normalizedSub), true);
    }
    return componentFor(resolved, null, familyRisk(name), false);
  }

  if (SINGLE_PURPOSE.has(name)) {
    return componentFor(resolved, null, 'none', false);
  }

  return componentFor(resolved, null, 'high', false);
}

function subcommandRisk(name: string, subcommand: string): BashScopeRisk {
  const normalized = subcommand.toLowerCase();
  if (EVALUATOR_SUBCOMMANDS[name]?.has(normalized)) return 'high';
  if (EXECUTOR_SUBCOMMANDS[name]?.has(normalized)) return 'executor';
  return familyRisk(name);
}

function familyRisk(name: string): BashScopeRisk {
  return HIGH_RISK_NAMES.has(name) ? 'high' : 'none';
}

function componentFor(
  executable: PersistentBashPermission['executable'],
  subcommand: string | null,
  risk: BashScopeRisk,
  includeBroader: boolean,
): ClassifiedBashComponent {
  const recommended: PersistentBashPermission = subcommand
    ? { kind: 'subcommand', executable, subcommand, enabled: true }
    : { kind: 'executable', executable, enabled: true };
  const broader = includeBroader && subcommand
    ? { kind: 'executable' as const, executable, enabled: true }
    : undefined;
  return {
    recommended,
    ...(broader ? { broader } : {}),
    risk,
    displayLabel: formatBashPermissionLabel(recommended),
  };
}

function stripTransparentWrappers(
  argv: readonly string[],
  caseInsensitive: boolean,
): string[] | 'unsafe' {
  let index = 0;
  while (index < argv.length && isStaticAssignment(argv[index]!)) {
    index += 1;
  }
  if (index < argv.length && isDynamicAssignment(argv[index]!)) return 'unsafe';

  while (index < argv.length) {
    const token = normalizeExecutableName(argv[index]!, caseInsensitive);
    if (token === 'env') {
      index += 1;
      while (index < argv.length) {
        const current = argv[index]!;
        if (current === '--') {
          index += 1;
          break;
        }
        if (current === '-u' || current === '--unset') {
          index += 2;
          continue;
        }
        if (current.startsWith('-') && current !== '-') {
          index += 1;
          continue;
        }
        if (isDynamicAssignment(current)) return 'unsafe';
        if (isStaticAssignment(current)) {
          index += 1;
          continue;
        }
        break;
      }
      continue;
    }
    if (token === 'command') {
      index += 1;
      while (index < argv.length && (argv[index] === '-p' || argv[index] === '-v' || argv[index] === '-V')) {
        index += 1;
      }
      continue;
    }
    break;
  }

  while (index < argv.length && isStaticAssignment(argv[index]!)) {
    index += 1;
  }
  if (index < argv.length && isDynamicAssignment(argv[index]!)) return 'unsafe';
  return argv.slice(index);
}

function isStaticAssignment(token: string): boolean {
  const eq = token.indexOf('=');
  if (eq <= 0) return false;
  const name = token.slice(0, eq);
  const value = token.slice(eq + 1);
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(name) && !/[$`*]/.test(value);
}

function isDynamicAssignment(token: string): boolean {
  const eq = token.indexOf('=');
  if (eq <= 0) return false;
  const name = token.slice(0, eq);
  const value = token.slice(eq + 1);
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(name) && /[$`*]/.test(value);
}

function firstNonFlag(argv: readonly string[]): string | undefined {
  for (const token of argv) {
    if (token === '--') continue;
    if (token.startsWith('-')) continue;
    return token;
  }
  return undefined;
}

function firstMatchingFlag(argv: readonly string[], flags: readonly string[]): string | undefined {
  const wanted = new Set(flags);
  for (const token of argv) {
    if (wanted.has(token)) return token;
  }
  return undefined;
}

function looksLikeInvocationData(token: string): boolean {
  return /[\\/]/.test(token)
    || /^\w+:\/\//.test(token)
    || /\.\w{1,8}$/.test(token);
}
