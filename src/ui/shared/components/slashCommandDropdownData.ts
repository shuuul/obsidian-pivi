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
  getServers(): Array<{ name: string; enabled: boolean; description?: string }>;
}

export interface DropdownSkillSummary {
  name: string;
  description?: string;
}


export interface DropdownItem {
  kind: 'command' | 'skill' | 'tool' | 'mcp';
  /** Stable key used for deduplication. */
  identity: string;
  /** Name shown after the slash prefix. */
  displayName: string;
  /** Canonical value inserted after the slash prefix. */
  insertValue: string;
  description?: string;
  argumentHint?: string;
  insertPrefix: string;
  slashCommand?: SlashCommand;
  serverName?: string;
  toolName?: string;
}

export type CatalogFetchResult =
  | { kind: 'noop' }
  | { kind: 'ok'; entries: SlashCatalogEntry[] };

export async function fetchCatalogEntries(
  catalogEntriesFetched: boolean,
  getCatalogEntries: (() => Promise<SlashCatalogEntry[]>) | null,
): Promise<CatalogFetchResult> {
  if (catalogEntriesFetched || !getCatalogEntries) {
    return { kind: 'noop' };
  }

  try {
    const entries = await getCatalogEntries();
    // Empty catalogs still count as fetched so we do not re-read vault on every `/` open.
    return { kind: 'ok', entries };
  } catch {
    return { kind: 'noop' };
  }
}

export type McpToolFetchResult =
  | { kind: 'noop'; fetched: boolean }
  | { kind: 'ok'; entries: DropdownItem[]; fetched: boolean };

export async function fetchMcpToolEntries(
  mcpToolEntriesFetched: boolean,
  getMcpManager: (() => DropdownMcpServerProvider | null) | null,
  getMcpToolProvider: (() => DropdownMcpToolProvider | null) | null,
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
  if (!toolProvider) {
    return {
      kind: 'ok',
      entries: servers.map((server) => createMcpServerEntry(server)),
      fetched: true,
    };
  }

  const perServerTools = await Promise.allSettled(
    servers.map(async (server) => ({
      serverName: server.name,
      tools: await toolProvider.listTools(server.name),
    })),
  );
  const toolsByServer = new Map<string, DropdownMcpToolSummary[]>();
  for (const settled of perServerTools) {
    if (settled.status === 'rejected') continue;
    const { serverName, tools } = settled.value;
    toolsByServer.set(serverName, tools);
  }

  const entries = servers.map((server) => createMcpServerEntry(
    server,
    toolsByServer.get(server.name),
  ));
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

function createMcpServerEntry(
  server: { name: string; description?: string },
  tools: readonly DropdownMcpToolSummary[] = [],
): DropdownItem {
  const configuredDescription = server.description?.trim();
  const toolNames = [...new Set(tools.map((tool) => tool.name.trim()).filter(Boolean))];

  return {
    kind: 'mcp',
    identity: `/${server.name.toLowerCase()}`,
    displayName: server.name,
    insertValue: server.name,
    description: configuredDescription || toolNames.join(' · ') || undefined,
    insertPrefix: '/',
    serverName: server.name,
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
    const item: DropdownItem = {
      kind: entry.kind,
      identity,
      displayName: entry.name,
      insertValue: entry.name,
      description: entry.description,
      argumentHint: entry.argumentHint,
      insertPrefix: entry.insertPrefix,
      toolName: entry.toolName,
    };
    if (entry.kind !== 'tool') {
      item.slashCommand = {
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
      };
    }
    items.push(item);
  }

  return items;
}
