/** Management tools that exclusively own Pivi-managed vault namespaces. */
export type PiviManagedPathTool = 'pivi_mcp' | 'pivi_skills' | 'pivi_commands';

export type AgentManagedPathMutationMode = 'direct' | 'recursive';

interface ManagedPathNamespace {
  tool: PiviManagedPathTool;
  files: readonly string[];
  filePrefixes: readonly string[];
  directories: readonly string[];
}

const PIVI_MANAGED_PATH_NAMESPACES: readonly ManagedPathNamespace[] = [
  {
    tool: 'pivi_mcp',
    files: ['.pivi/mcp.json'],
    filePrefixes: ['.pivi/mcp.json.'],
    directories: ['.pivi/mcp-oauth'],
  },
  {
    tool: 'pivi_skills',
    files: [
      '.pivi/skills-lock.json',
      '.pivi/.skills.json',
      'skills-lock.json',
      '.skills.json',
    ],
    filePrefixes: [],
    directories: [
      '.pivi/skills',
      '.pivi/skills-staging',
      '.pivi/skills-install-',
      '.pivi/skills-list-',
      '.pivi/skills-remove-',
      '.pivi/skills-update-',
      '.pivi/skills-update-all-',
      '.pivi/skills-default-update-',
      '.pivi/.skills-transaction-',
      '.pivi/.skills-publication-',
      '.pivi/.skills-backup-',
      '.pivi/.agents/skills',
      '.pivi/.cursor/skills',
    ],
  },
  {
    tool: 'pivi_commands',
    files: [],
    filePrefixes: [],
    directories: ['.pivi/commands', '.pivi/templates', '.pivi/.commands-removal-'],
  },
];

function canonicalizeVaultRelativePath(value: string): string {
  return value.replace(/\\/g, '/').replace(/\/+$/, '');
}

function isExactOrDescendant(candidate: string, root: string): boolean {
  return candidate === root || candidate.startsWith(`${root}/`)
    || (root.endsWith('-') && candidate.startsWith(root));
}

function isStrictAncestor(candidate: string, root: string): boolean {
  return root.startsWith(`${candidate}/`);
}

function matchesNamespace(
  candidate: string,
  namespace: ManagedPathNamespace,
  mode: AgentManagedPathMutationMode,
): boolean {
  for (const file of namespace.files) {
    if (candidate === file || (mode === 'recursive' && isStrictAncestor(candidate, file))) return true;
  }
  for (const prefix of namespace.filePrefixes) {
    if (candidate.startsWith(prefix)) return true;
    const parent = prefix.includes('/') ? prefix.slice(0, prefix.lastIndexOf('/')) : '';
    if (mode === 'recursive' && parent && (candidate === parent || isStrictAncestor(candidate, parent))) return true;
  }
  for (const directory of namespace.directories) {
    if (isExactOrDescendant(candidate, directory)
      || (mode === 'recursive' && isStrictAncestor(candidate, directory))) return true;
  }
  return false;
}

/** Pure, browser-safe policy for canonical vault-relative Agent mutation paths. */
export function assertAgentManagedPathMutationAllowed(
  vaultRelativePath: string,
  options: { mode?: AgentManagedPathMutationMode } = {},
): void {
  const candidate = canonicalizeVaultRelativePath(vaultRelativePath);
  if (!candidate) return;
  const mode = options.mode ?? 'direct';
  const conflict = PIVI_MANAGED_PATH_NAMESPACES.find(namespace =>
    matchesNamespace(candidate, namespace, mode));
  if (!conflict) return;
  throw new Error(
    `Path "${candidate}" is managed by Pivi. `
    + `Use the \`${conflict.tool}\` tool instead of generic vault mutation APIs.`,
  );
}
