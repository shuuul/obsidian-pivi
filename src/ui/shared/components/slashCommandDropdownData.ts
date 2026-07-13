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
  name: string;
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
  | { kind: 'ok'; entries: DropdownItem[]; fetched: true };

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
  if (!mcpManager || !toolProvider) {
    return { kind: 'noop', fetched: true };
  }

  const servers = mcpManager.getServers().filter((server) => server.enabled);
  try {
    const perServerTools = await Promise.all(
      servers.map(async (server) => ({
        serverName: server.name,
        tools: await toolProvider.listTools(server.name),
      })),
    );
    if (currentRequest !== requestId) {
      return { kind: 'cancelled' };
    }

    const entries: DropdownItem[] = [];
    for (const { serverName, tools } of perServerTools) {
      for (const tool of tools) {
        entries.push({
          kind: 'mcp',
          name: `${serverName}/${tool.name}`,
          description: tool.description,
          content: '',
          displayPrefix: '/',
          insertPrefix: '/',
          serverName,
          toolName: tool.name,
        });
      }
    }
    return { kind: 'ok', entries, fetched: true };
  } catch {
    if (currentRequest !== requestId) {
      return { kind: 'cancelled' };
    }
    return { kind: 'noop', fetched: true };
  }
}

export function buildItemList(
  getSkills: (() => DropdownSkillSummary[]) | null,
  cachedMcpToolEntries: DropdownItem[],
  cachedCatalogEntries: SlashCatalogEntry[],
  hiddenCommands: Set<string>,
  _includeBuiltIns: boolean,
): DropdownItem[] {
  const seenNames = new Set<string>();
  const items: DropdownItem[] = [];

  for (const skill of getSkills?.() ?? []) {
    const nameLower = skill.name.toLowerCase();
    if (!seenNames.has(nameLower)) {
      seenNames.add(nameLower);
      items.push({
        kind: 'skill',
        name: skill.name,
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
    const nameLower = entry.name.toLowerCase();
    if (seenNames.has(nameLower)) {
      continue;
    }
    seenNames.add(nameLower);
    items.push(entry);
  }

  for (const entry of cachedCatalogEntries) {
    const nameLower = entry.name.toLowerCase();
    if (seenNames.has(nameLower) || hiddenCommands.has(nameLower)) {
      continue;
    }
    seenNames.add(nameLower);
    items.push({
      kind: entry.kind === 'command' ? 'command' : 'skill',
      name: entry.name,
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