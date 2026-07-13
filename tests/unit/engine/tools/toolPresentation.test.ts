import * as obsidianToolNames from '@pivi/pivi-agent-core/tools/obsidianToolNames';
import {
  OBSIDIAN_AGENT_TOOLS,
  OBSIDIAN_OPTIONAL_TOOLS,
  TOOL_OBSIDIAN_BASE,
  TOOL_OBSIDIAN_BASH,
  TOOL_OBSIDIAN_DAILY,
  TOOL_OBSIDIAN_EDIT,
  TOOL_OBSIDIAN_GRAPH,
  TOOL_OBSIDIAN_LIST,
  TOOL_OBSIDIAN_MOVE,
  TOOL_OBSIDIAN_READ,
  TOOL_OBSIDIAN_SEARCH,
} from '@pivi/pivi-agent-core/tools/obsidianToolNames';
import {
  getToolPresentationDescriptor,
  isToolPresentationGroupable,
  MCP_ICON_MARKER,
  normalizeWebSearchDisplayData,
  parseObsidianSearchHits,
  resolveToolPresentation,
  shouldPresentToolCall,
  summarizeObsidianSearchHits,
  TOOL_PRESENTATION_DESCRIPTORS,
} from '@pivi/pivi-agent-core/tools/toolPresentation';
import * as toolNames from '@pivi/pivi-agent-core/tools/toolNames';
import {
  TOOL_APPLY_PATCH,
  TOOL_ASK_USER_QUESTION,
  TOOL_BASH,
  TOOL_READ,
  TOOL_SKILL,
  TOOL_SPAWN_AGENT,
  TOOL_TODO_WRITE,
  TOOL_WEB_SEARCH,
  TOOL_WRITE_STDIN,
} from '@pivi/pivi-agent-core/tools/toolNames';

function exportedToolNames(module: Record<string, unknown>): string[] {
  return [...new Set(Object.entries(module)
    .filter(([key, value]) => key.startsWith('TOOL_') && typeof value === 'string')
    .map(([, value]) => value as string))];
}

type ExpectedDescriptor = {
  icon: string;
  kind: string;
  labelKey: string | undefined;
  stepPhraseKey: string | undefined;
  className: string | undefined;
  visibility: string;
  grouping: string;
};

function expectedDescriptor(
  icon: string,
  kind = 'default',
  overrides: Partial<ExpectedDescriptor> = {},
): ExpectedDescriptor {
  return {
    icon,
    kind,
    labelKey: undefined,
    stepPhraseKey: undefined,
    className: undefined,
    visibility: 'visible',
    grouping: 'groupable',
    ...overrides,
  };
}

function descriptorShape(name: string): ExpectedDescriptor {
  const descriptor = getToolPresentationDescriptor(name);
  return {
    icon: descriptor.icon,
    kind: descriptor.kind,
    labelKey: descriptor.labelKey,
    stepPhraseKey: descriptor.stepPhraseKey,
    className: descriptor.className,
    visibility: descriptor.visibility,
    grouping: descriptor.grouping,
  };
}

const EXPECTED_DESCRIPTORS: Readonly<Record<string, ExpectedDescriptor>> = {
  TaskOutput: expectedDescriptor('bot', 'agent', { visibility: 'hidden' }),
  AskUserQuestion: expectedDescriptor('help-circle', 'ask-user', { grouping: 'solo' }),
  Bash: expectedDescriptor('terminal', 'shell', {
    stepPhraseKey: 'tools.steps.runCommand', className: 'bash',
  }),
  BashOutput: expectedDescriptor('terminal', 'shell'),
  Edit: expectedDescriptor('file-pen', 'file', { stepPhraseKey: 'tools.steps.editFile' }),
  Glob: expectedDescriptor('folder-search', 'search', { stepPhraseKey: 'tools.steps.globFiles' }),
  Grep: expectedDescriptor('search', 'search', { stepPhraseKey: 'tools.steps.searchCode' }),
  KillShell: expectedDescriptor('terminal', 'shell'),
  LS: expectedDescriptor('list', 'file', { stepPhraseKey: 'tools.steps.listDir' }),
  ListMcpResources: expectedDescriptor('list', 'mcp', { stepPhraseKey: 'tools.steps.listMcpResources' }),
  mcp: expectedDescriptor('wrench', 'mcp'),
  NotebookEdit: expectedDescriptor('file-pen', 'file', { stepPhraseKey: 'tools.steps.editNotebook' }),
  Read: expectedDescriptor('file-text', 'file', { stepPhraseKey: 'tools.steps.readFile' }),
  ReadMcpResource: expectedDescriptor('file-text', 'mcp', { stepPhraseKey: 'tools.steps.readMcpResource' }),
  skill: expectedDescriptor('sparkles', 'skill', {
    labelKey: 'tools.steps.skill', stepPhraseKey: 'tools.steps.runSkill',
  }),
  Agent: expectedDescriptor('bot', 'agent', { grouping: 'solo' }),
  Task: expectedDescriptor('bot', 'agent', { grouping: 'solo' }),
  TodoWrite: expectedDescriptor('list-checks', 'todo', {
    labelKey: 'tools.steps.tasks', grouping: 'solo',
  }),
  ToolSearch: expectedDescriptor('search-check', 'search', { stepPhraseKey: 'tools.steps.findTools' }),
  WebFetch: expectedDescriptor('download', 'web', {
    stepPhraseKey: 'tools.steps.fetchPage', className: 'web',
  }),
  WebSearch: expectedDescriptor('globe', 'web', {
    stepPhraseKey: 'tools.steps.searchWeb', className: 'web',
  }),
  Write: expectedDescriptor('file-plus', 'file', { stepPhraseKey: 'tools.steps.writeFile' }),
  apply_patch: expectedDescriptor('file-pen', 'file', { stepPhraseKey: 'tools.steps.applyPatch' }),
  write_stdin: expectedDescriptor('terminal', 'shell', {
    stepPhraseKey: 'tools.steps.sendInput', visibility: 'hidden-when-empty-chars',
  }),
  spawn_agent: expectedDescriptor('bot', 'agent', { grouping: 'solo' }),
  send_input: expectedDescriptor('bot', 'agent'),
  wait: expectedDescriptor('clock', 'agent'),
  wait_agent: expectedDescriptor('clock', 'agent'),
  resume_agent: expectedDescriptor('bot', 'agent'),
  close_agent: expectedDescriptor('bot', 'agent'),
  Mcp: expectedDescriptor('wrench', 'mcp', { stepPhraseKey: 'tools.steps.callMcp' }),
  custom_tool_call_output: expectedDescriptor('wrench', 'default', { visibility: 'hidden' }),

  obsidian_read: expectedDescriptor('file-text', 'obsidian', { labelKey: 'tools.display.read' }),
  obsidian_read_external: expectedDescriptor('file-text', 'obsidian', { labelKey: 'tools.display.readExternal' }),
  obsidian_markdown_structure: expectedDescriptor('list-tree', 'obsidian', { labelKey: 'tools.display.outline' }),
  obsidian_edit: expectedDescriptor('file-pen', 'obsidian', { labelKey: 'tools.display.edit' }),
  obsidian_write: expectedDescriptor('file-plus', 'obsidian', { labelKey: 'tools.display.write' }),
  obsidian_search: expectedDescriptor('search', 'obsidian', { labelKey: 'tools.display.search' }),
  obsidian_note_info: expectedDescriptor('info', 'obsidian', { labelKey: 'tools.display.noteInfo' }),
  obsidian_links: expectedDescriptor('link', 'obsidian', { labelKey: 'tools.display.links' }),
  obsidian_properties: expectedDescriptor('list-checks', 'obsidian', { labelKey: 'tools.display.properties' }),
  obsidian_tasks: expectedDescriptor('list-todo', 'obsidian', { labelKey: 'tools.display.tasks' }),
  obsidian_history: expectedDescriptor('history', 'obsidian', { labelKey: 'tools.display.history' }),
  obsidian_delete: expectedDescriptor('trash-2', 'obsidian', { labelKey: 'tools.display.delete' }),
  obsidian_move: expectedDescriptor('file-input', 'obsidian', { labelKey: 'tools.display.move' }),
  obsidian_list: expectedDescriptor('list', 'obsidian', { labelKey: 'tools.display.list' }),
  obsidian_list_external: expectedDescriptor('list', 'obsidian', { labelKey: 'tools.display.listExternal' }),
  obsidian_mkdir: expectedDescriptor('folder-plus', 'obsidian', { labelKey: 'tools.display.mkdir' }),
  obsidian_open: expectedDescriptor('external-link', 'obsidian', { labelKey: 'tools.display.open' }),
  obsidian_attachment: expectedDescriptor('paperclip', 'obsidian', { labelKey: 'tools.display.attachment' }),
  obsidian_generate_image: expectedDescriptor('image-plus', 'obsidian', { labelKey: 'tools.display.generateImage' }),
  obsidian_command: expectedDescriptor('terminal', 'obsidian', { labelKey: 'tools.display.command' }),
  obsidian_bash: expectedDescriptor('terminal', 'obsidian', { labelKey: 'tools.display.bash' }),
  obsidian_eval: expectedDescriptor('braces', 'obsidian', { labelKey: 'tools.display.eval' }),
  obsidian_daily: expectedDescriptor('calendar', 'obsidian', { labelKey: 'tools.display.daily' }),
  obsidian_graph: expectedDescriptor('share-2', 'obsidian', { labelKey: 'tools.display.graph' }),
  obsidian_tags: expectedDescriptor('tag', 'obsidian', { labelKey: 'tools.display.tags' }),
  obsidian_base: expectedDescriptor('database', 'obsidian', { labelKey: 'tools.display.base' }),
};

describe('tool presentation registry', () => {
  it('locks the complete descriptor matrix for every exported tool and runtime literal', () => {
    const expectedNames = [...new Set([
      ...exportedToolNames(toolNames),
      ...exportedToolNames(obsidianToolNames),
      'Mcp',
      'custom_tool_call_output',
    ])].sort();

    expect(Object.keys(EXPECTED_DESCRIPTORS).sort()).toEqual(expectedNames);

    for (const name of expectedNames) {
      expect(TOOL_PRESENTATION_DESCRIPTORS).toHaveProperty(name);
      expect(descriptorShape(name)).toEqual(EXPECTED_DESCRIPTORS[name]);
    }
  });

  it('owns label keys for all 26 Obsidian tools', () => {
    const obsidianTools = [...OBSIDIAN_AGENT_TOOLS, ...OBSIDIAN_OPTIONAL_TOOLS];
    expect(obsidianTools).toHaveLength(26);
    expect(obsidianTools.map(name => getToolPresentationDescriptor(name).labelKey)).toEqual([
      'tools.display.read',
      'tools.display.outline',
      'tools.display.edit',
      'tools.display.write',
      'tools.display.search',
      'tools.display.noteInfo',
      'tools.display.links',
      'tools.display.properties',
      'tools.display.tasks',
      'tools.display.history',
      'tools.display.delete',
      'tools.display.move',
      'tools.display.list',
      'tools.display.mkdir',
      'tools.display.open',
      'tools.display.attachment',
      'tools.display.generateImage',
      'tools.display.daily',
      'tools.display.graph',
      'tools.display.tags',
      'tools.display.base',
      'tools.display.readExternal',
      'tools.display.listExternal',
      'tools.display.command',
      'tools.display.bash',
      'tools.display.eval',
    ]);
  });

  it('owns canonical step phrase keys', () => {
    expect(getToolPresentationDescriptor(TOOL_READ).stepPhraseKey).toBe('tools.steps.readFile');
    expect(getToolPresentationDescriptor(TOOL_BASH).stepPhraseKey).toBe('tools.steps.runCommand');
    expect(getToolPresentationDescriptor(TOOL_WEB_SEARCH).stepPhraseKey).toBe('tools.steps.searchWeb');
    expect(getToolPresentationDescriptor(TOOL_SKILL).stepPhraseKey).toBe('tools.steps.runSkill');
    expect(getToolPresentationDescriptor(TOOL_APPLY_PATCH).stepPhraseKey).toBe('tools.steps.applyPatch');
    expect(getToolPresentationDescriptor(TOOL_WRITE_STDIN).stepPhraseKey).toBe('tools.steps.sendInput');
  });

  it('resolves todo progress and skill titles without translated strings', () => {
    expect(resolveToolPresentation(TOOL_TODO_WRITE, {
      todos: [{ status: 'completed' }, { status: 'in_progress' }],
    })).toMatchObject({
      title: { key: 'tools.steps.tasksProgress', params: { completed: 1, total: 2 } },
      summary: '',
      todoProgress: { completed: 1, total: 2 },
    });
    expect(resolveToolPresentation(TOOL_SKILL, { name: 'defuddle', args: 'extract article' }))
      .toMatchObject({
        title: { fallback: 'defuddle' },
        summary: 'extract article',
        todoProgress: null,
      });
  });

  it('summarizes files, shell commands, web actions, patches, and stdin', () => {
    expect(resolveToolPresentation(TOOL_READ, { file_path: 'notes/today.md' }).summary)
      .toBe('today.md');
    expect(resolveToolPresentation(TOOL_BASH, { command: 'npm run test' }).summary)
      .toBe('npm run test');
    expect(resolveToolPresentation(TOOL_WEB_SEARCH, {
      url: 'https://example.com',
      pattern: 'needle',
    }).summary).toBe('Find "needle" in https://example.com');
    expect(resolveToolPresentation(TOOL_APPLY_PATCH, {
      patch: '*** Begin Patch\n*** Update File: src/a.ts\n*** Add File: src/b.ts\n*** End Patch',
    }).summary).toBe('2 files');
    expect(resolveToolPresentation(TOOL_WRITE_STDIN, {
      session_id: 'abc123',
      chars: 'hello\nworld',
    }).summary).toBe('#abc123 hello\\nworld');
  });

  it('summarizes agent lifecycle operations', () => {
    expect(resolveToolPresentation(TOOL_SPAWN_AGENT, { message: 'Review the port boundary' }).summary)
      .toBe('Review the port boundary');
    expect(resolveToolPresentation('wait', { ids: ['a', 'b'], timeout_ms: 5_000 }).summary)
      .toBe('2 agents, 5s');
  });

  it('locks every non-trivial summary resolver family to its owning tool semantics', () => {
    const patch = '*** Begin Patch\n*** Update File: src/a.ts\n*** Add File: src/b.ts\n*** End Patch';
    const cases: ReadonlyArray<{
      name: string;
      input: Record<string, unknown>;
      result?: string;
      expected: string;
    }> = [
      { name: 'Read', input: { file_path: 'vault/read.md', path: 'wrong' }, expected: 'read.md' },
      { name: 'Write', input: { file_path: 'vault/write.md', path: 'wrong' }, expected: 'write.md' },
      { name: 'Edit', input: { file_path: 'vault/edit.md', path: 'wrong' }, expected: 'edit.md' },
      { name: 'LS', input: { path: 'vault/folder', file_path: 'wrong.md' }, expected: 'folder' },
      { name: 'apply_patch', input: { patch }, expected: '2 files' },
      { name: 'Bash', input: { command: 'npm run test', url: 'wrong' }, expected: 'npm run test' },
      { name: 'write_stdin', input: { session_id: 'session', chars: 'go\nnow' }, expected: '#session go\\nnow' },
      { name: 'Glob', input: { pattern: '**/*.ts', command: 'wrong' }, expected: '**/*.ts' },
      { name: 'Grep', input: { pattern: 'needle', command: 'wrong' }, expected: 'needle' },
      { name: 'ToolSearch', input: { query: 'select:alpha, beta', url: 'wrong' }, expected: 'alpha, beta' },
      { name: 'WebSearch', input: { query: 'architecture ports', url: '' }, expected: 'architecture ports' },
      { name: 'WebFetch', input: { url: 'https://example.com/page', query: 'wrong' }, expected: 'https://example.com/page' },
      { name: 'skill', input: { name: 'review', args: 'check boundaries', query: 'wrong' }, expected: 'check boundaries' },
      { name: 'spawn_agent', input: { message: 'inventory package edges', command: 'wrong' }, expected: 'inventory package edges' },
      { name: 'send_input', input: { message: 'continue verification', command: 'wrong' }, expected: 'continue verification' },
      { name: 'wait', input: { ids: ['a'], timeout_ms: 2_000 }, expected: '1 agent, 2s' },
      { name: 'wait_agent', input: { ids: ['a', 'b', 'c'], timeout_ms: 7_000 }, expected: '3 agents, 7s' },

      { name: 'obsidian_read', input: { path: 'notes/read.md', action: 'wrong' }, expected: 'notes/read.md' },
      { name: 'obsidian_read_external', input: { path: '/tmp/external.md', action: 'wrong' }, expected: '/tmp/external.md' },
      { name: 'obsidian_markdown_structure', input: { path: 'notes/outline.md', action: 'wrong' }, expected: 'notes/outline.md' },
      { name: 'obsidian_edit', input: { path: 'notes/edit.md', mode: 'wrong' }, expected: 'edit · notes/edit.md' },
      { name: 'obsidian_write', input: { path: 'notes/write.md', mode: 'append' }, expected: 'append · notes/write.md' },
      {
        name: 'obsidian_search',
        input: { query: 'needle', path: 'notes' },
        result: JSON.stringify([{ path: 'notes/hit.md', line: 4 }]),
        expected: 'needle · notes · notes/hit.md:4',
      },
      { name: 'obsidian_note_info', input: { action: 'stat', path: 'wrong.md' }, expected: 'stat' },
      { name: 'obsidian_links', input: { path: 'notes/links.md' }, expected: 'outgoing · notes/links.md' },
      {
        name: 'obsidian_properties',
        input: { action: 'set', name: 'status', path: 'notes/property.md' },
        expected: 'set · status · notes/property.md',
      },
      { name: 'obsidian_tasks', input: { action: 'list', path: 'notes/tasks.md' }, expected: 'list · notes/tasks.md' },
      { name: 'obsidian_history', input: { action: 'recent' }, expected: 'recent · vault' },
      { name: 'obsidian_delete', input: { path: 'notes/delete.md', action: 'wrong' }, expected: 'notes/delete.md' },
      {
        name: 'obsidian_move',
        input: { path: 'notes/old.md', newPath: 'archive/new.md' },
        expected: 'notes/old.md → archive/new.md',
      },
      { name: 'obsidian_list', input: { path: 'notes/list', action: 'wrong' }, expected: 'notes/list' },
      { name: 'obsidian_list_external', input: { path: '/tmp/list', action: 'wrong' }, expected: '/tmp/list' },
      { name: 'obsidian_mkdir', input: { path: 'notes/new-folder', action: 'wrong' }, expected: 'notes/new-folder' },
      { name: 'obsidian_open', input: { path: 'notes/open.md', action: 'wrong' }, expected: 'notes/open.md' },
      { name: 'obsidian_attachment', input: { filename: 'diagram.png' }, expected: 'diagram.png' },
      { name: 'obsidian_generate_image', input: { prompt: 'ink drawing', command: 'wrong' }, expected: 'ink drawing' },
      { name: 'obsidian_command', input: { id: 'workspace:split', command: 'wrong' }, expected: 'workspace:split' },
      { name: 'obsidian_bash', input: { command: 'pwd', id: 'wrong' }, expected: 'pwd' },
      { name: 'obsidian_eval', input: { code: 'return app.vault', command: 'wrong' }, expected: 'return app.vault' },
      { name: 'obsidian_daily', input: { action: 'open', path: 'wrong.md' }, expected: 'open' },
      { name: 'obsidian_graph', input: { actions: ['orphans', 'unresolved'], action: 'wrong' }, expected: 'orphans,unresolved' },
      { name: 'obsidian_tags', input: { action: 'rename', name: '#old' }, expected: 'rename · #old' },
      {
        name: 'obsidian_base',
        input: { action: 'query', path: 'bases/projects.base', view: 'Active' },
        expected: 'query · bases/projects.base · view: Active',
      },
    ];

    for (const testCase of cases) {
      expect(resolveToolPresentation(testCase.name, testCase.input, testCase.result).summary)
        .toBe(testCase.expected);
    }
  });

  it('locks deliberate drift choices to ASCII truncation and wait_agent summaries', () => {
    const longCommand = 'x'.repeat(61);
    expect(resolveToolPresentation(TOOL_BASH, { command: longCommand }).summary)
      .toBe(`${'x'.repeat(60)}...`);
    expect(resolveToolPresentation('send_input', { message: 'y'.repeat(41) }).summary)
      .toBe(`${'y'.repeat(40)}...`);
    expect(resolveToolPresentation('wait_agent', {
      ids: ['one', 'two'],
      timeout_ms: 9_000,
    }).summary).toBe('2 agents, 9s');
  });

  it('summarizes representative Obsidian path and action tools', () => {
    expect(resolveToolPresentation(TOOL_OBSIDIAN_READ, { path: 'notes/today.md' }).summary)
      .toBe('notes/today.md');
    expect(resolveToolPresentation(TOOL_OBSIDIAN_EDIT, { path: 'notes/today.md' }).summary)
      .toBe('edit · notes/today.md');
    expect(resolveToolPresentation(TOOL_OBSIDIAN_MOVE, {
      path: 'old/location/note.md',
      newPath: 'new/location/note.md',
    }).summary).toBe('old/location/note.md → new/location/note.md');
    expect(resolveToolPresentation(TOOL_OBSIDIAN_BASH, { command: 'pwd' }).summary).toBe('pwd');
    expect(resolveToolPresentation(TOOL_OBSIDIAN_DAILY, {}).summary).toBe('daily');
    expect(resolveToolPresentation(TOOL_OBSIDIAN_GRAPH, { actions: ['orphans', 'unresolved'] }).summary)
      .toBe('orphans,unresolved');
    expect(resolveToolPresentation(TOOL_OBSIDIAN_BASE, {
      action: 'query',
      path: 'bases/projects.base',
      view: 'Current projects',
    }).summary).toBe('query · bases/projects.base · view: Current projects');
  });

  it('uses completed Obsidian search results in the canonical summary', () => {
    const result = JSON.stringify([{ path: 'month/2026-2.md', line: 7 }]);
    expect(resolveToolPresentation(
      TOOL_OBSIDIAN_SEARCH,
      { query: '*', path: 'month' },
      result,
    ).summary).toBe('* · month · month/2026-2.md:7');
  });

  it('normalizes web action metadata and safely parses Obsidian search results', () => {
    expect(normalizeWebSearchDisplayData({ url: 'https://example.com', pattern: 'needle' })).toEqual({
      actionType: 'find_in_page',
      pattern: 'needle',
      queries: [],
      query: '',
      url: 'https://example.com',
    });
    const hits = parseObsidianSearchHits(JSON.stringify([
      { path: 'one.md', line: 3 },
      null,
      { path: 'two.md' },
      { nope: true },
    ]));
    expect(hits).toEqual([{ path: 'one.md', line: 3 }, { path: 'two.md' }]);
    expect(summarizeObsidianSearchHits(hits)).toBe('one.md:3, two.md');
    expect(parseObsidianSearchHits('not json')).toEqual([]);
  });

  it('provides explicit unknown and dynamic MCP fallbacks', () => {
    expect(getToolPresentationDescriptor('UnknownTool')).toMatchObject({ icon: 'wrench' });
    expect(resolveToolPresentation('UnknownTool', {})).toMatchObject({
      title: { fallback: 'UnknownTool' },
      summary: '',
      todoProgress: null,
    });
    expect(getToolPresentationDescriptor('mcp__server__tool')).toMatchObject({
      icon: MCP_ICON_MARKER,
    });
  });

  it('centralizes tool visibility and grouping policy', () => {
    expect(shouldPresentToolCall('TaskOutput', {})).toBe(false);
    expect(shouldPresentToolCall('custom_tool_call_output', {})).toBe(false);
    expect(shouldPresentToolCall(TOOL_WRITE_STDIN, {})).toBe(false);
    expect(shouldPresentToolCall(TOOL_WRITE_STDIN, { chars: 'continue' })).toBe(true);

    expect(isToolPresentationGroupable(TOOL_READ, {})).toBe(true);
    expect(isToolPresentationGroupable(TOOL_TODO_WRITE, {})).toBe(false);
    expect(isToolPresentationGroupable(TOOL_ASK_USER_QUESTION, {})).toBe(false);
    expect(isToolPresentationGroupable(TOOL_SPAWN_AGENT, {})).toBe(false);
    expect(isToolPresentationGroupable(TOOL_READ, {}, true)).toBe(false);
  });

  it('keeps valid empty Obsidian list input registered as a normal list tool', () => {
    expect(getToolPresentationDescriptor(TOOL_OBSIDIAN_LIST)).toBe(TOOL_PRESENTATION_DESCRIPTORS[TOOL_OBSIDIAN_LIST]);
  });
});
