import {
  TOOL_OBSIDIAN_ATTACHMENT,
  TOOL_OBSIDIAN_BASE,
  TOOL_OBSIDIAN_BASH,
  TOOL_OBSIDIAN_COMMAND,
  TOOL_OBSIDIAN_DAILY,
  TOOL_OBSIDIAN_DELETE,
  TOOL_OBSIDIAN_EDIT,
  TOOL_OBSIDIAN_EVAL,
  TOOL_OBSIDIAN_GENERATE_IMAGE,
  TOOL_OBSIDIAN_GRAPH,
  TOOL_OBSIDIAN_HISTORY,
  TOOL_OBSIDIAN_LINKS,
  TOOL_OBSIDIAN_LIST,
  TOOL_OBSIDIAN_LIST_EXTERNAL,
  TOOL_OBSIDIAN_MARKDOWN_STRUCTURE,
  TOOL_OBSIDIAN_MKDIR,
  TOOL_OBSIDIAN_MOVE,
  TOOL_OBSIDIAN_NOTE_INFO,
  TOOL_OBSIDIAN_OPEN,
  TOOL_OBSIDIAN_PROPERTIES,
  TOOL_OBSIDIAN_READ,
  TOOL_OBSIDIAN_READ_EXTERNAL,
  TOOL_OBSIDIAN_SEARCH,
  TOOL_OBSIDIAN_TAGS,
  TOOL_OBSIDIAN_TASKS,
  TOOL_OBSIDIAN_WRITE,
} from './obsidianToolNames';
import {
  TOOL_AGENT_OUTPUT,
  TOOL_APPLY_PATCH,
  TOOL_ASK_USER_QUESTION,
  TOOL_BASH,
  TOOL_BASH_OUTPUT,
  TOOL_CLOSE_AGENT,
  TOOL_EDIT,
  TOOL_GLOB,
  TOOL_GREP,
  TOOL_KILL_SHELL,
  TOOL_LIST_MCP_RESOURCES,
  TOOL_LS,
  TOOL_MCP,
  TOOL_NOTEBOOK_EDIT,
  TOOL_READ,
  TOOL_READ_MCP_RESOURCE,
  TOOL_RESUME_AGENT,
  TOOL_SEND_INPUT,
  TOOL_SKILL,
  TOOL_SPAWN_AGENT,
  TOOL_SUBAGENT_LEGACY,
  TOOL_TASK,
  TOOL_TODO_WRITE,
  TOOL_TOOL_SEARCH,
  TOOL_WAIT,
  TOOL_WAIT_AGENT,
  TOOL_WEB_FETCH,
  TOOL_WEB_SEARCH,
  TOOL_WRITE,
  TOOL_WRITE_STDIN,
} from './toolNames';
import {
  normalizeWebSearchDisplayData,
  parseObsidianSearchHits,
  summarizeApplyPatch,
  summarizeFileInput,
  summarizeInput,
  summarizeNone,
  summarizeObsidianActionTarget,
  summarizeObsidianAttachment,
  summarizeObsidianBase,
  summarizeObsidianDaily,
  summarizeObsidianEdit,
  summarizeObsidianGraph,
  summarizeObsidianHistory,
  summarizeObsidianLinks,
  summarizeObsidianMove,
  summarizeObsidianNoteInfo,
  summarizeObsidianProperties,
  summarizeObsidianSearch,
  summarizeObsidianSearchHits,
  summarizeObsidianTags,
  summarizeObsidianTarget,
  summarizeObsidianWrite,
  summarizeSendInput,
  summarizeSpawnAgent,
  summarizeToolSearch,
  summarizeWait,
  summarizeWebSearch,
  summarizeWriteStdin,
  toolFileName,
  type ToolSummaryResolver,
  truncateToolText,
} from './toolPresentationSummary';

export {
  normalizeWebSearchDisplayData,
  parseObsidianSearchHits,
  summarizeObsidianSearchHits,
  toolFileName,
};

export type ToolPresentationTranslationKey =
  | 'tools.display.attachment'
  | 'tools.display.base'
  | 'tools.display.bash'
  | 'tools.display.command'
  | 'tools.display.daily'
  | 'tools.display.delete'
  | 'tools.display.edit'
  | 'tools.display.eval'
  | 'tools.display.generateImage'
  | 'tools.display.graph'
  | 'tools.display.history'
  | 'tools.display.links'
  | 'tools.display.list'
  | 'tools.display.listExternal'
  | 'tools.display.mkdir'
  | 'tools.display.move'
  | 'tools.display.noteInfo'
  | 'tools.display.open'
  | 'tools.display.outline'
  | 'tools.display.properties'
  | 'tools.display.read'
  | 'tools.display.readExternal'
  | 'tools.display.search'
  | 'tools.display.tags'
  | 'tools.display.tasks'
  | 'tools.display.write'
  | 'tools.steps.applyPatch'
  | 'tools.steps.callMcp'
  | 'tools.steps.editFile'
  | 'tools.steps.editNotebook'
  | 'tools.steps.fetchPage'
  | 'tools.steps.findTools'
  | 'tools.steps.globFiles'
  | 'tools.steps.listDir'
  | 'tools.steps.listMcpResources'
  | 'tools.steps.readFile'
  | 'tools.steps.readMcpResource'
  | 'tools.steps.runCommand'
  | 'tools.steps.runSkill'
  | 'tools.steps.searchCode'
  | 'tools.steps.searchWeb'
  | 'tools.steps.sendInput'
  | 'tools.steps.skill'
  | 'tools.steps.tasks'
  | 'tools.steps.tasksProgress'
  | 'tools.steps.writeFile';

export type ToolPresentationKind =
  | 'agent'
  | 'ask-user'
  | 'default'
  | 'file'
  | 'mcp'
  | 'obsidian'
  | 'search'
  | 'shell'
  | 'skill'
  | 'todo'
  | 'web';

export type ToolPresentationVisibility = 'hidden' | 'hidden-when-empty-chars' | 'visible';
export type ToolPresentationGrouping = 'groupable' | 'solo';

export interface ToolPresentationDescriptor {
  readonly kind: ToolPresentationKind;
  readonly icon: string;
  readonly labelKey?: ToolPresentationTranslationKey;
  readonly stepPhraseKey?: ToolPresentationTranslationKey;
  readonly className?: 'bash' | 'web';
  readonly visibility: ToolPresentationVisibility;
  readonly grouping: ToolPresentationGrouping;
}

interface ToolPresentationEntry extends ToolPresentationDescriptor {
  readonly summarize: ToolSummaryResolver;
}

export interface ToolPresentationTitle {
  readonly fallback: string;
  readonly key?: ToolPresentationTranslationKey;
  readonly params?: Readonly<Record<string, string | number>>;
}

export interface ResolvedToolPresentation {
  readonly descriptor: ToolPresentationDescriptor;
  readonly title: ToolPresentationTitle;
  readonly summary: string;
  readonly todoProgress: { readonly completed: number; readonly total: number } | null;
}

/** Special marker for MCP tools; presentation adapters render the custom SVG. */
export const MCP_ICON_MARKER = '__mcp_icon__';

const DEFAULT_ENTRY: ToolPresentationEntry = {
  kind: 'default',
  icon: 'wrench',
  visibility: 'visible',
  grouping: 'groupable',
  summarize: summarizeNone,
};

const MCP_ENTRY: ToolPresentationEntry = {
  ...DEFAULT_ENTRY,
  kind: 'mcp',
  icon: MCP_ICON_MARKER,
};

function entry(
  icon: string,
  overrides: Partial<ToolPresentationEntry> = {},
): ToolPresentationEntry {
  return { ...DEFAULT_ENTRY, icon, ...overrides };
}

const file = (icon: string, summarize: ToolSummaryResolver, stepPhraseKey?: ToolPresentationTranslationKey) =>
  entry(icon, { kind: 'file', summarize, stepPhraseKey });

const obsidian = (
  icon: string,
  labelKey: ToolPresentationTranslationKey,
  summarize: ToolSummaryResolver,
) => entry(icon, { kind: 'obsidian', labelKey, summarize });

export const TOOL_PRESENTATION_DESCRIPTORS: Readonly<Record<string, ToolPresentationEntry>> = {
  [TOOL_READ]: file('file-text', summarizeFileInput('file_path'), 'tools.steps.readFile'),
  [TOOL_WRITE]: file('file-plus', summarizeFileInput('file_path'), 'tools.steps.writeFile'),
  [TOOL_EDIT]: file('file-pen', summarizeFileInput('file_path'), 'tools.steps.editFile'),
  [TOOL_NOTEBOOK_EDIT]: file('file-pen', summarizeNone, 'tools.steps.editNotebook'),
  [TOOL_APPLY_PATCH]: file('file-pen', summarizeApplyPatch, 'tools.steps.applyPatch'),
  [TOOL_LS]: file('list', summarizeFileInput('path', '.'), 'tools.steps.listDir'),

  [TOOL_BASH]: entry('terminal', {
    kind: 'shell', className: 'bash', summarize: summarizeInput('command', 60),
    stepPhraseKey: 'tools.steps.runCommand',
  }),
  [TOOL_BASH_OUTPUT]: entry('terminal', { kind: 'shell' }),
  [TOOL_KILL_SHELL]: entry('terminal', { kind: 'shell' }),
  [TOOL_WRITE_STDIN]: entry('terminal', {
    kind: 'shell', summarize: summarizeWriteStdin, stepPhraseKey: 'tools.steps.sendInput',
    visibility: 'hidden-when-empty-chars',
  }),
  [TOOL_GLOB]: entry('folder-search', {
    kind: 'search', summarize: summarizeInput('pattern'), stepPhraseKey: 'tools.steps.globFiles',
  }),
  [TOOL_GREP]: entry('search', {
    kind: 'search', summarize: summarizeInput('pattern'), stepPhraseKey: 'tools.steps.searchCode',
  }),
  [TOOL_TOOL_SEARCH]: entry('search-check', {
    kind: 'search', summarize: summarizeToolSearch, stepPhraseKey: 'tools.steps.findTools',
  }),
  [TOOL_WEB_SEARCH]: entry('globe', {
    kind: 'web', className: 'web', summarize: summarizeWebSearch,
    stepPhraseKey: 'tools.steps.searchWeb',
  }),
  [TOOL_WEB_FETCH]: entry('download', {
    kind: 'web', className: 'web', summarize: summarizeInput('url', 60),
    stepPhraseKey: 'tools.steps.fetchPage',
  }),
  [TOOL_TODO_WRITE]: entry('list-checks', {
    kind: 'todo', grouping: 'solo', labelKey: 'tools.steps.tasks',
  }),
  [TOOL_SKILL]: entry('sparkles', {
    kind: 'skill', summarize: summarizeInput('args', 60), labelKey: 'tools.steps.skill',
    stepPhraseKey: 'tools.steps.runSkill',
  }),
  [TOOL_TASK]: entry('bot', { kind: 'agent', grouping: 'solo' }),
  [TOOL_SUBAGENT_LEGACY]: entry('bot', { kind: 'agent', grouping: 'solo' }),
  [TOOL_AGENT_OUTPUT]: entry('bot', { kind: 'agent', visibility: 'hidden' }),
  [TOOL_ASK_USER_QUESTION]: entry('help-circle', { kind: 'ask-user', grouping: 'solo' }),
  [TOOL_SPAWN_AGENT]: entry('bot', {
    kind: 'agent', grouping: 'solo', summarize: summarizeSpawnAgent,
  }),
  [TOOL_SEND_INPUT]: entry('bot', { kind: 'agent', summarize: summarizeSendInput }),
  [TOOL_WAIT]: entry('clock', { kind: 'agent', summarize: summarizeWait }),
  [TOOL_WAIT_AGENT]: entry('clock', { kind: 'agent', summarize: summarizeWait }),
  [TOOL_RESUME_AGENT]: entry('bot', { kind: 'agent' }),
  [TOOL_CLOSE_AGENT]: entry('bot', { kind: 'agent' }),
  [TOOL_MCP]: entry(MCP_ICON_MARKER, { kind: 'mcp' }),
  Mcp: entry('wrench', { kind: 'mcp', stepPhraseKey: 'tools.steps.callMcp' }),
  [TOOL_LIST_MCP_RESOURCES]: entry('list', {
    kind: 'mcp', stepPhraseKey: 'tools.steps.listMcpResources',
  }),
  [TOOL_READ_MCP_RESOURCE]: entry('file-text', {
    kind: 'mcp', stepPhraseKey: 'tools.steps.readMcpResource',
  }),
  custom_tool_call_output: entry('wrench', { visibility: 'hidden' }),

  [TOOL_OBSIDIAN_READ]: obsidian('file-text', 'tools.display.read', summarizeObsidianTarget),
  [TOOL_OBSIDIAN_READ_EXTERNAL]: obsidian('file-text', 'tools.display.readExternal', summarizeObsidianTarget),
  [TOOL_OBSIDIAN_MARKDOWN_STRUCTURE]: obsidian('list-tree', 'tools.display.outline', summarizeObsidianTarget),
  [TOOL_OBSIDIAN_EDIT]: obsidian('file-pen', 'tools.display.edit', summarizeObsidianEdit),
  [TOOL_OBSIDIAN_WRITE]: obsidian('file-plus', 'tools.display.write', summarizeObsidianWrite),
  [TOOL_OBSIDIAN_SEARCH]: obsidian('search', 'tools.display.search', summarizeObsidianSearch),
  [TOOL_OBSIDIAN_NOTE_INFO]: obsidian('info', 'tools.display.noteInfo', summarizeObsidianNoteInfo),
  [TOOL_OBSIDIAN_LINKS]: obsidian('link', 'tools.display.links', summarizeObsidianLinks),
  [TOOL_OBSIDIAN_PROPERTIES]: obsidian('list-checks', 'tools.display.properties', summarizeObsidianProperties),
  [TOOL_OBSIDIAN_TASKS]: obsidian('list-todo', 'tools.display.tasks', summarizeObsidianActionTarget),
  [TOOL_OBSIDIAN_HISTORY]: obsidian('history', 'tools.display.history', summarizeObsidianHistory),
  [TOOL_OBSIDIAN_DELETE]: obsidian('trash-2', 'tools.display.delete', summarizeObsidianTarget),
  [TOOL_OBSIDIAN_MOVE]: obsidian('file-input', 'tools.display.move', summarizeObsidianMove),
  [TOOL_OBSIDIAN_LIST]: obsidian('list', 'tools.display.list', summarizeObsidianTarget),
  [TOOL_OBSIDIAN_LIST_EXTERNAL]: obsidian('list', 'tools.display.listExternal', summarizeObsidianTarget),
  [TOOL_OBSIDIAN_MKDIR]: obsidian('folder-plus', 'tools.display.mkdir', summarizeObsidianTarget),
  [TOOL_OBSIDIAN_OPEN]: obsidian('external-link', 'tools.display.open', summarizeObsidianTarget),
  [TOOL_OBSIDIAN_ATTACHMENT]: obsidian('paperclip', 'tools.display.attachment', summarizeObsidianAttachment),
  [TOOL_OBSIDIAN_GENERATE_IMAGE]: obsidian('image-plus', 'tools.display.generateImage', summarizeInput('prompt', 48)),
  [TOOL_OBSIDIAN_BASH]: obsidian('terminal', 'tools.display.bash', summarizeInput('command', 48)),
  [TOOL_OBSIDIAN_COMMAND]: obsidian('terminal', 'tools.display.command', summarizeInput('id', 48)),
  [TOOL_OBSIDIAN_EVAL]: obsidian('braces', 'tools.display.eval', summarizeInput('code', 40)),
  [TOOL_OBSIDIAN_DAILY]: obsidian('calendar', 'tools.display.daily', summarizeObsidianDaily),
  [TOOL_OBSIDIAN_GRAPH]: obsidian('share-2', 'tools.display.graph', summarizeObsidianGraph),
  [TOOL_OBSIDIAN_TAGS]: obsidian('tag', 'tools.display.tags', summarizeObsidianTags),
  [TOOL_OBSIDIAN_BASE]: obsidian('database', 'tools.display.base', summarizeObsidianBase),
};

function resolveTodoProgress(input: Record<string, unknown>) {
  if (!Array.isArray(input.todos)) return null;
  const completed = input.todos.filter(todo =>
    todo !== null
    && typeof todo === 'object'
    && (todo as Record<string, unknown>).status === 'completed'
  ).length;
  return { completed, total: input.todos.length };
}

export function getToolPresentationDescriptor(name: string): ToolPresentationDescriptor {
  return name.startsWith('mcp__') ? MCP_ENTRY : (TOOL_PRESENTATION_DESCRIPTORS[name] ?? DEFAULT_ENTRY);
}

function getEntry(name: string): ToolPresentationEntry {
  return name.startsWith('mcp__') ? MCP_ENTRY : (TOOL_PRESENTATION_DESCRIPTORS[name] ?? DEFAULT_ENTRY);
}

export function resolveToolPresentation(
  name: string,
  input: Record<string, unknown>,
  result?: string,
): ResolvedToolPresentation {
  const descriptor = getEntry(name);
  const todoProgress = name === TOOL_TODO_WRITE ? resolveTodoProgress(input) : null;
  if (todoProgress) {
    return {
      descriptor,
      title: {
        fallback: `Tasks ${todoProgress.completed}/${todoProgress.total}`,
        key: 'tools.steps.tasksProgress',
        params: todoProgress,
      },
      summary: '',
      todoProgress,
    };
  }
  if (name === TOOL_MCP) {
    const serverName = typeof input.server === 'string' ? input.server.trim() : '';
    const toolName = typeof input.tool === 'string' ? input.tool.trim() : '';
    if (serverName && toolName) {
      return {
        descriptor,
        title: { fallback: `${serverName}/${toolName}` },
        summary: descriptor.summarize(input, result),
        todoProgress,
      };
    }
  }
  if (name === TOOL_SKILL) {
    const skillName = typeof input.name === 'string' ? input.name.trim() : '';
    if (skillName) {
      return {
        descriptor,
        title: { fallback: skillName },
        summary: descriptor.summarize(input, result),
        todoProgress,
      };
    }
  }
  return {
    descriptor,
    title: { fallback: name, ...(descriptor.labelKey ? { key: descriptor.labelKey } : {}) },
    summary: descriptor.summarize(input, result),
    todoProgress,
  };
}

export function getToolIcon(name: string): string {
  return getToolPresentationDescriptor(name).icon;
}

export function getToolStepPhraseModel(
  name: string,
  input: Record<string, unknown>,
  result?: string,
): { readonly base: ToolPresentationTitle; readonly summary: string } {
  const resolved = resolveToolPresentation(name, input, result);
  const key = resolved.descriptor.stepPhraseKey;
  return {
    base: key ? { fallback: resolved.title.fallback, key } : resolved.title,
    summary: truncateToolText(resolved.summary, 72),
  };
}

export function shouldPresentToolCall(name: string, input: Record<string, unknown>): boolean {
  const descriptor = getToolPresentationDescriptor(name);
  if (descriptor.visibility === 'hidden') return false;
  if (descriptor.visibility === 'hidden-when-empty-chars') {
    return typeof input.chars === 'string' && input.chars.length > 0;
  }
  return true;
}

export function isToolPresentationGroupable(
  name: string,
  input: Record<string, unknown>,
  hasSubagent = false,
): boolean {
  if (hasSubagent || !shouldPresentToolCall(name, input)) return false;
  return getToolPresentationDescriptor(name).grouping === 'groupable';
}
