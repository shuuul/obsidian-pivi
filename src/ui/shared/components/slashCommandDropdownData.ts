import type { SlashCommand } from '@pivi/pivi-agent-core/foundation';
import type { SlashCatalogEntry } from '@pivi/pivi-agent-core/skills/commands/slashCommandEntry';

export interface DropdownMcpToolSummary {
  name: string;
  description?: string;
}

export interface DropdownMcpToolProvider {
  listTools(serverName: string): Promise<DropdownMcpToolSummary[]>;
}

export interface DropdownMcpServerProvider {
  getServers(): Array<{ name: string; enabled: boolean }>;
}

export interface DropdownSkillSummary {
  name: string;
  description?: string;
}


export interface DropdownItem {
  kind: 'command' | 'skill' | 'mcp';
  /** Stable key used for deduplication. */
  identity: string;
  /** Name shown after the slash prefix. */
  displayName: string;
  /** Canonical value inserted after the slash prefix. */
  insertValue: string;
  description?: string;
  argumentHint?: string;
  content: string;
  displayPrefix: string;
  insertPrefix: string;
  slashCommand?: SlashCommand;
  catalogEntry?: SlashCatalogEntry;
  serverName?: string;
  toolName?: string;
}

export type CatalogFetchResult =
  | { kind: 'noop' }
  | { kind: 'cancelled' }
  | { kind: 'ok'; entries: SlashCatalogEntry[] };

export async function fetchCatalogEntries(
  catalogEntriesFetched: boolean,
  getCatalogEntries: (() => Promise<SlashCatalogEntry[]>) | null,
  currentRequest: number,
  requestId: number,
): Promise<CatalogFetchResult> {
  if (catalogEntriesFetched || !getCatalogEntries) {
    return { kind: 'noop' };
  }

  try {
    const entries = await getCatalogEntries();
    if (currentRequest !== requestId) {
      return { kind: 'cancelled' };
    }
    // Empty catalogs still count as fetched so we do not re-read vault on every `/` open.
    return { kind: 'ok', entries };
  } catch {
    if (currentRequest !== requestId) {
      return { kind: 'cancelled' };
    }
    return { kind: 'noop' };
  }
}

export type McpToolFetchResult =
  | { kind: 'noop'; fetched: boolean }
  | { kind: 'cancelled' }
  | { kind: 'ok'; entries: DropdownItem[]; fetched: boolean };

export async function fetchMcpToolEntries(
  mcpToolEntriesFetched: boolean,
  getMcpManager: (() => DropdownMcpServerProvider | null) | null,
  getMcpToolProvider: (() => DropdownMcpToolProvider | null) | null,
  currentRequest: number,
  requestId: number,
): Promise<McpToolFetchResult> {
  if (mcpToolEntriesFetched) {
    return { kind: 'noop', fetched: true };
  }

  const mcpManager = getMcpManager?.() ?? null;
  const toolProvider = getMcpToolProvider?.() ?? null;
  if (!mcpManager) {
    return { kind: 'noop', fetched: true };
  }

  const servers = mcpManager.getServers().filter((server) => server.enabled);
  const serverEntries: DropdownItem[] = servers.map((server) => ({
    kind: 'mcp',
    identity: `/${server.name.toLowerCase()}`,
    displayName: server.name,
    insertValue: server.name,
    content: '',
    displayPrefix: '/',
    insertPrefix: '/',
    serverName: server.name,
  }));
  if (!toolProvider) {
    return { kind: 'ok', entries: serverEntries, fetched: true };
  }

  const perServerTools = await Promise.allSettled(
    servers.map(async (server) => ({
      serverName: server.name,
      tools: await toolProvider.listTools(server.name),
    })),
  );
  if (currentRequest !== requestId) {
    return { kind: 'cancelled' };
  }

  const entries = [...serverEntries];
  for (const settled of perServerTools) {
    if (settled.status === 'rejected') continue;
    const { serverName, tools } = settled.value;
    for (const tool of tools) {
      entries.push({
        kind: 'mcp',
        identity: `/${serverName.toLowerCase()}/${tool.name.toLowerCase()}`,
        displayName: tool.name,
        insertValue: `${serverName}/${tool.name}`,
        description: tool.description,
        content: '',
        displayPrefix: '/',
        insertPrefix: '/',
        serverName,
        toolName: tool.name,
      });
    }
  }
  return {
    kind: 'ok',
    entries,
    // Retry after partial failures so one unavailable server cannot permanently hide its tools.
    fetched: perServerTools.every((settled) => settled.status === 'fulfilled'),
  };
}

export function mergeMcpEntries(
  cachedEntries: readonly DropdownItem[],
  fetchedEntries: readonly DropdownItem[],
): DropdownItem[] {
  const merged = new Map(cachedEntries.map((entry) => [entry.identity, entry]));
  for (const entry of fetchedEntries) {
    merged.set(entry.identity, entry);
  }
  return [...merged.values()];
}

export function buildItemList(
  getSkills: (() => DropdownSkillSummary[]) | null,
  cachedMcpToolEntries: DropdownItem[],
  cachedCatalogEntries: SlashCatalogEntry[],
  hiddenCommands: Set<string>,
  _includeBuiltIns: boolean,
): DropdownItem[] {
  const seenIdentities = new Set<string>();
  const items: DropdownItem[] = [];

  for (const skill of getSkills?.() ?? []) {
    const identity = `/${skill.name.toLowerCase()}`;
    if (!seenIdentities.has(identity)) {
      seenIdentities.add(identity);
      items.push({
        kind: 'skill',
        identity,
        displayName: skill.name,
        insertValue: skill.name,
        description: skill.description,
        content: '',
        displayPrefix: '/',
        insertPrefix: '/',
        slashCommand: {
          id: `skill:${skill.name}`,
          name: skill.name,
          description: skill.description,
          content: '',
          source: 'sdk',
          kind: 'skill',
        },
      });
    }
  }

  for (const entry of cachedMcpToolEntries) {
    if (seenIdentities.has(entry.identity)) {
      continue;
    }
    seenIdentities.add(entry.identity);
    items.push(entry);
  }

  for (const entry of cachedCatalogEntries) {
    const nameLower = entry.name.toLowerCase();
    const identity = `${entry.insertPrefix}${entry.name}`.toLowerCase();
    if (seenIdentities.has(identity) || hiddenCommands.has(nameLower)) {
      continue;
    }
    seenIdentities.add(identity);
    items.push({
      kind: entry.kind === 'command' ? 'command' : 'skill',
      identity,
      displayName: entry.name,
      insertValue: entry.name,
      description: entry.description,
      argumentHint: entry.argumentHint,
      content: entry.content,
      displayPrefix: entry.displayPrefix,
      insertPrefix: entry.insertPrefix,
      catalogEntry: entry,
      slashCommand: {
        id: entry.id,
        name: entry.name,
        description: entry.description,
        content: entry.content,
        argumentHint: entry.argumentHint,
        allowedTools: entry.allowedTools,
        model: entry.model,
        source: entry.source,
        kind: entry.kind,
        disableModelInvocation: entry.disableModelInvocation,
        userInvocable: entry.userInvocable,
        context: entry.context,
        agent: entry.agent,
        hooks: entry.hooks,
      },
    });
  }

  return items;
}
