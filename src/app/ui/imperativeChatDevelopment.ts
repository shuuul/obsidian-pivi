import type { ChatMessage } from '@pivi/agent/runtime';
import type { ChatProjectionMessageChange } from '@pivi/pivi-react/store';

import type {
  PiviChatCompositionHost,
  PiviChatDevelopmentCommands,
} from '@/app/hostContracts';
import type { TabManager } from '@/ui/chat/tabs/TabManager';
import type { TabId } from '@/ui/chat/tabs/types';

const DEVELOPMENT_MARKDOWN_BYTES = 100 * 1024;
const DEVELOPMENT_MARKDOWN_CHUNK_BYTES = 1_600;
const DEVELOPMENT_MARKDOWN_SETTLE_MS = 750;
const DEVELOPMENT_SUBAGENTS_FIXTURE = '.pivi/sessions/perf-004-20-subagents.jsonl';
const DEVELOPMENT_SUBAGENTS_SETTLE_MS = 750;
const DEVELOPMENT_PAGING_FIXTURE = '.pivi/sessions/perf-002-5k-messages.jsonl';
const DEVELOPMENT_PAGING_SETTLE_MS = 750;
const DEVELOPMENT_PROJECTION_SETTLE_MS = 250;
const DEVELOPMENT_SWITCHING_MESSAGE_COUNT = 100;
const DEVELOPMENT_SWITCHING_PASSES = 2;
const DEVELOPMENT_SWITCHING_TAB_COUNT = 10;
export const DEVELOPMENT_PROJECTION_WARMUP_EVENTS = 5;
export const DEVELOPMENT_PROJECTION_SAMPLE_EVENTS = 50;

export type DevelopmentProjectionWorkload =
  | 'nested-subagent'
  | 'small-text'
  | 'tool-heavy';

interface DevelopmentProjectionWorkloadFixture {
  readonly eventType: ChatProjectionMessageChange['type'];
  readonly fixtureSha256: string;
  readonly message: ChatMessage;
}

export const DEVELOPMENT_PROJECTION_WORKLOADS: Readonly<
  Record<DevelopmentProjectionWorkload, DevelopmentProjectionWorkloadFixture>
> = Object.freeze({
  'small-text': {
    eventType: 'text.append',
    fixtureSha256: '8c7e161e1c431ad5f5479a35cc9ac6ea0ae0da3222562cbaff3cb78981d26334',
    message: {
      id: 'pivi-development-projection-small-text',
      role: 'assistant',
      content: 'Deterministic small text sample 000.',
      contentBlocks: [{ type: 'text', content: 'Deterministic small text sample 000.' }],
      timestamp: 1,
    },
  },
  'tool-heavy': {
    eventType: 'tool.upsert',
    fixtureSha256: '8dd0b9f55e255124b89e9c621bace9635489d55f4458ab658217c9a7cf9d7b65',
    message: {
      id: 'pivi-development-projection-tool-heavy',
      role: 'assistant',
      content: 'Twelve deterministic tool calls.',
      contentBlocks: [
        { type: 'text', content: 'Twelve deterministic tool calls.' },
        ...Array.from({ length: 12 }, (_, index) => ({
          type: 'tool_use' as const,
          toolId: `projection-tool-${String(index + 1).padStart(2, '0')}`,
        })),
      ],
      toolCalls: Array.from({ length: 12 }, (_, index) => ({
        id: `projection-tool-${String(index + 1).padStart(2, '0')}`,
        name: 'obsidian_read',
        input: { path: `Reading/Fixture-${String(index + 1).padStart(2, '0')}.md` },
        status: 'running' as const,
        result: 'Deterministic tool result 000.',
        isExpanded: false,
      })),
      timestamp: 1,
    },
  },
  'nested-subagent': {
    eventType: 'agent.upsert',
    fixtureSha256: '26657f173f9bcdad0727d4db6971d7e7dc57a7462a6197ff676174e99e53ac6c',
    message: {
      id: 'pivi-development-projection-nested-subagent',
      role: 'assistant',
      content: 'One deterministic nested subagent.',
      contentBlocks: [
        { type: 'text', content: 'One deterministic nested subagent.' },
        { type: 'subagent', subagentId: 'projection-subagent-01', mode: 'async' },
      ],
      toolCalls: [{
        id: 'projection-spawn-01',
        name: 'spawn_agent',
        input: {
          label: 'Projection fixture',
          message: 'Inspect deterministic fixture notes.',
          run_in_background: true,
        },
        status: 'running',
        isExpanded: false,
        subagent: {
          id: 'projection-subagent-01',
          agentId: 'projection-agent-01',
          description: 'Inspect deterministic fixture notes',
          prompt: 'Inspect deterministic fixture notes.',
          mode: 'async',
          isExpanded: false,
          result: 'Deterministic subagent result 000.',
          status: 'running',
          asyncStatus: 'running',
          toolCalls: Array.from({ length: 8 }, (_, index) => ({
            id: `projection-nested-tool-${String(index + 1).padStart(2, '0')}`,
            name: 'obsidian_read',
            input: { path: `Research/Nested-${String(index + 1).padStart(2, '0')}.md` },
            status: 'completed' as const,
            result: `Nested deterministic result ${String(index + 1).padStart(2, '0')}.`,
            isExpanded: false,
          })),
        },
      }],
      timestamp: 1,
    },
  },
});

type DevelopmentMarkdownStreamState = {
  messages: ChatMessage[];
  isStreaming: boolean;
  addMessage(message: ChatMessage): void;
  notifyMessageChanged(message: ChatMessage): void;
  flushProjection(): void;
};

type DevelopmentProjectionState = Pick<
  DevelopmentMarkdownStreamState,
  'addMessage' | 'isStreaming' | 'messages'
> & {
  notifyMessageChanged(
    message: ChatMessage,
    change: ChatProjectionMessageChange,
  ): void;
};

type DevelopmentMarkdownTabManager = Pick<
  TabManager,
  'closeTab' | 'createTab' | 'getActiveTabId' | 'getTab' | 'switchToTab'
>;

function createDevelopmentMarkdown(): string {
  const heading = '# Deterministic streaming Markdown\n\n';
  const paragraph = [
    '## Stable section\n\n',
    'This paragraph contains **bold text**, `inline code`, a ',
    '[link](https://example.com), and stable prose for real Obsidian rendering.\n\n',
  ].join('');
  let markdown = heading;
  while (markdown.length + paragraph.length <= DEVELOPMENT_MARKDOWN_BYTES) {
    markdown += paragraph;
  }
  return markdown.padEnd(DEVELOPMENT_MARKDOWN_BYTES, 'x');
}

function cloneProjectionWorkloadMessage(workload: DevelopmentProjectionWorkload): ChatMessage {
  return JSON.parse(
    JSON.stringify(DEVELOPMENT_PROJECTION_WORKLOADS[workload].message),
  ) as ChatMessage;
}

function applyProjectionWorkloadEvent(
  workload: DevelopmentProjectionWorkload,
  state: DevelopmentProjectionState,
  message: ChatMessage,
  eventIndex: number,
): void {
  const suffix = String(eventIndex).padStart(3, '0');
  switch (workload) {
    case 'small-text': {
      message.content = `Deterministic small text sample ${suffix}.`;
      const block = message.contentBlocks?.[0];
      if (!block || block.type !== 'text') throw new Error('Small-text fixture lost its text block.');
      block.content = message.content;
      state.notifyMessageChanged(message, {
        type: 'text.append',
        blockId: `${message.id}:block:0`,
        delta: suffix,
      });
      break;
    }
    case 'tool-heavy': {
      const tool = message.toolCalls?.[eventIndex % 12];
      if (!tool) throw new Error('Tool-heavy fixture lost a tool call.');
      tool.result = `Deterministic tool result ${suffix}.`;
      state.notifyMessageChanged(message, { type: 'tool.upsert', tool });
      break;
    }
    case 'nested-subagent': {
      const subagent = message.toolCalls?.[0]?.subagent;
      if (!subagent) throw new Error('Nested-subagent fixture lost its subagent.');
      subagent.result = `Deterministic subagent result ${suffix}.`;
      state.notifyMessageChanged(message, { type: 'agent.upsert', agent: subagent });
      break;
    }
  }
}

async function runProjectionEvents(
  workload: DevelopmentProjectionWorkload,
  state: DevelopmentProjectionState,
  message: ChatMessage,
  ownerWindow: Window,
  firstEvent: number,
  count: number,
): Promise<void> {
  for (let index = firstEvent; index < firstEvent + count; index += 1) {
    applyProjectionWorkloadEvent(workload, state, message, index);
    await nextAnimationFrame(ownerWindow);
  }
  await nextAnimationFrame(ownerWindow);
  await nextAnimationFrame(ownerWindow);
}

function nextAnimationFrame(ownerWindow: Window): Promise<void> {
  return new Promise(resolve => ownerWindow.requestAnimationFrame(() => resolve()));
}

async function settleDevelopmentRender(ownerWindow: Window, durationMs: number): Promise<void> {
  await nextAnimationFrame(ownerWindow);
  await nextAnimationFrame(ownerWindow);
  await new Promise(resolve => ownerWindow.setTimeout(resolve, durationMs));
}

async function waitForDevelopmentMessageCount(
  ownerWindow: Window,
  getCount: () => number,
  minimum: number,
): Promise<void> {
  const deadline = ownerWindow.performance.now() + 5_000;
  while (getCount() < minimum) {
    if (ownerWindow.performance.now() >= deadline) {
      throw new Error('Timed out waiting for the indexed older page to render.');
    }
    await new Promise(resolve => ownerWindow.setTimeout(resolve, 16));
  }
}

async function createDevelopmentSessionFixture(
  plugin: PiviChatCompositionHost,
  runId: number,
  sourceFile: string,
  fixtureName: string,
): Promise<string> {
  const adapter = plugin.app.vault.adapter;
  const source = await adapter.read(sourceFile);
  const lineEnd = source.indexOf('\n');
  if (lineEnd < 0) {
    throw new Error('The performance fixture has no JSONL entries.');
  }
  const header = JSON.parse(source.slice(0, lineEnd)) as Record<string, unknown>;
  if (header.type !== 'session') {
    throw new Error('The performance fixture has no session header.');
  }
  header.id = `pivi-development-${fixtureName}-${runId}`;
  const sessionFile = `.pivi/sessions/perf-isolated-${fixtureName}-${runId}.jsonl`;
  await adapter.write(sessionFile, `${JSON.stringify(header)}${source.slice(lineEnd)}`);
  return sessionFile;
}

async function removeDevelopmentSessionFixture(
  plugin: PiviChatCompositionHost,
  sessionFile: string,
): Promise<void> {
  const adapter = plugin.app.vault.adapter;
  const indexFile = `${sessionFile}.pivi-index`;
  if (await adapter.exists(indexFile)) await adapter.remove(indexFile);
  if (await adapter.exists(sessionFile)) await adapter.remove(sessionFile);
}

export async function runDevelopment20Subagents(
  manager: TabManager,
  ownerWindow: Window,
  plugin: PiviChatCompositionHost,
  hooks: Parameters<PiviChatDevelopmentCommands['run20SubagentsWorkload']>[0],
): Promise<Awaited<ReturnType<PiviChatDevelopmentCommands['run20SubagentsWorkload']>>> {
  const originalTabId = manager.getActiveTabId();
  if (!originalTabId) {
    throw new Error('An active chat tab is required for the 20-subagent workload.');
  }

  const runId = Date.now();
  const tabId = `pivi-development-subagents-${runId}`;
  const sessionFile = await createDevelopmentSessionFixture(
    plugin,
    runId,
    DEVELOPMENT_SUBAGENTS_FIXTURE,
    'subagents',
  );
  try {
    const tab = await manager.createTab(undefined, tabId, { sessionFile });
    if (!tab || tab.id !== tabId) {
      throw new Error('Failed to create the isolated 20-subagent tab.');
    }
    await settleDevelopmentRender(ownerWindow, DEVELOPMENT_SUBAGENTS_SETTLE_MS);
    const subagents = tab.state.messages.reduce((count, message) => (
      count + (message.toolCalls?.filter(toolCall => toolCall.subagent).length ?? 0)
    ), 0);
    if (subagents !== 20) {
      throw new Error(`Expected 20 subagents, received ${subagents}.`);
    }
    const result = { subagents, messages: tab.state.messages.length };
    await hooks.afterRender(result);
    return result;
  } finally {
    try {
      if (manager.getTab(originalTabId)) await manager.switchToTab(originalTabId);
      if (manager.getTab(tabId)) await manager.closeTab(tabId, true);
    } finally {
      await removeDevelopmentSessionFixture(plugin, sessionFile);
    }
  }
}

export async function runDevelopmentIndexedSessionPaging(
  manager: TabManager,
  ownerWindow: Window,
  plugin: PiviChatCompositionHost,
  hooks: Parameters<PiviChatDevelopmentCommands['runIndexedSessionPagingWorkload']>[0],
): Promise<Awaited<ReturnType<PiviChatDevelopmentCommands['runIndexedSessionPagingWorkload']>>> {
  const originalTabId = manager.getActiveTabId();
  if (!originalTabId) {
    throw new Error('An active chat tab is required for the indexed paging workload.');
  }

  const runId = Date.now();
  const tabId = `pivi-development-indexed-paging-${runId}`;
  const sessionFile = await createDevelopmentSessionFixture(
    plugin,
    runId,
    DEVELOPMENT_PAGING_FIXTURE,
    'indexed-paging',
  );
  try {
    const tab = await manager.createTab(undefined, tabId, {
      sessionFile,
    });
    if (!tab || tab.id !== tabId) {
      throw new Error('Failed to create the isolated indexed paging tab.');
    }
    await settleDevelopmentRender(ownerWindow, DEVELOPMENT_PAGING_SETTLE_MS);
    const initialMessages = tab.state.messages.length;
    await hooks.afterColdOpen();

    const messagesEl = tab.dom.messagesEl;
    messagesEl.scrollTop = 0;
    messagesEl.dispatchEvent(new Event('scroll'));
    await waitForDevelopmentMessageCount(
      ownerWindow,
      () => tab.state.messages.length,
      initialMessages + 1,
    );
    await settleDevelopmentRender(ownerWindow, DEVELOPMENT_PAGING_SETTLE_MS);
    const messagesAfterPrepend = tab.state.messages.length;
    await hooks.afterOlderPage();
    return { initialMessages, messagesAfterPrepend };
  } finally {
    try {
      if (manager.getTab(originalTabId)) {
        await manager.switchToTab(originalTabId);
      }
      if (manager.getTab(tabId)) {
        await manager.closeTab(tabId, true);
      }
    } finally {
      await removeDevelopmentSessionFixture(plugin, sessionFile);
    }
  }
}

function createDevelopmentTabMessages(tabIndex: number): ChatMessage[] {
  return Array.from({ length: DEVELOPMENT_SWITCHING_MESSAGE_COUNT }, (_, messageIndex) => ({
    id: `pivi-development-tab-${tabIndex}-message-${messageIndex}`,
    role: messageIndex % 2 === 0 ? 'user' : 'assistant',
    content: `## Tab ${tabIndex + 1}\n\nDeterministic message ${messageIndex + 1}.`,
    timestamp: messageIndex + 1,
  }));
}

/** Creates, switches, and removes ten in-memory tabs without binding session files. */
export async function runDevelopmentTabSwitching(
  manager: TabManager,
  ownerWindow: Window,
): Promise<Awaited<ReturnType<PiviChatDevelopmentCommands['runTabSwitchingWorkload']>>> {
  const originalTabId = manager.getActiveTabId();
  if (!originalTabId) {
    throw new Error('An active chat tab is required for the switching workload.');
  }

  const runId = Date.now();
  const tabIds: TabId[] = [];
  let switches = 0;
  let startedAt = 0;

  try {
    for (let index = 0; index < DEVELOPMENT_SWITCHING_TAB_COUNT; index += 1) {
      const tabId = `pivi-development-tab-switch-${runId}-${index}`;
      const tab = await manager.createTab(undefined, tabId, {
        activate: false,
        draftTitle: `Performance tab ${index + 1}`,
      });
      if (!tab) throw new Error(`Failed to create development tab ${index + 1}.`);
      tab.state.messages = createDevelopmentTabMessages(index);
      tabIds.push(tab.id);
    }

    await nextAnimationFrame(ownerWindow);
    startedAt = ownerWindow.performance.now();
    for (let pass = 0; pass < DEVELOPMENT_SWITCHING_PASSES; pass += 1) {
      for (const tabId of tabIds) {
        await manager.switchToTab(tabId);
        switches += 1;
        await nextAnimationFrame(ownerWindow);
        await nextAnimationFrame(ownerWindow);
      }
    }

    return {
      tabs: tabIds.length,
      switches,
      durationMs: ownerWindow.performance.now() - startedAt,
    };
  } finally {
    if (manager.getTab(originalTabId)) {
      await manager.switchToTab(originalTabId);
    }
    for (const tabId of [...tabIds].reverse()) {
      await manager.closeTab(tabId, true);
    }
  }
}

/** Drives the real active-tab projection and Markdown adapter without invoking a model. */
export async function runDevelopmentMarkdownStream(
  state: DevelopmentMarkdownStreamState,
  ownerWindow: Window,
): Promise<Awaited<ReturnType<PiviChatDevelopmentCommands['run100KbMarkdownStream']>>> {
  if (state.isStreaming) {
    throw new Error('Cannot run the Markdown performance stream while a turn is active.');
  }
  const originalMessages = state.messages;
  const originalStreaming = state.isStreaming;
  const markdown = createDevelopmentMarkdown();
  const turnId = Date.now();
  const userMessage: ChatMessage = {
    id: `pivi-development-markdown-stream-user-${turnId}`,
    role: 'user',
    content: 'Render the deterministic 100 KB Markdown stream.',
    timestamp: turnId,
  };
  const message: ChatMessage = {
    id: `pivi-development-markdown-stream-assistant-${turnId}`,
    role: 'assistant',
    content: '',
    contentBlocks: [{ type: 'text', content: '' }],
    timestamp: Date.now(),
  };
  const startedAt = ownerWindow.performance.now();
  let chunks = 0;

  try {
    state.isStreaming = true;
    state.addMessage(userMessage);
    state.addMessage(message);
    await nextAnimationFrame(ownerWindow);

    for (let offset = 0; offset < markdown.length; offset += DEVELOPMENT_MARKDOWN_CHUNK_BYTES) {
      const chunk = markdown.slice(offset, offset + DEVELOPMENT_MARKDOWN_CHUNK_BYTES);
      message.content += chunk;
      const block = message.contentBlocks?.[0];
      if (!block || block.type !== 'text') {
        throw new Error('Development Markdown stream lost its text block.');
      }
      block.content = message.content;
      state.notifyMessageChanged(message);
      chunks += 1;
      await nextAnimationFrame(ownerWindow);
    }

    state.flushProjection();
    await nextAnimationFrame(ownerWindow);
    state.isStreaming = false;
    await new Promise(resolve => ownerWindow.setTimeout(resolve, DEVELOPMENT_MARKDOWN_SETTLE_MS));
    return {
      bytes: markdown.length,
      chunks,
      durationMs: ownerWindow.performance.now() - startedAt,
    };
  } finally {
    state.messages = originalMessages;
    state.isStreaming = originalStreaming;
  }
}

/** Runs the Markdown workload in a disposable in-memory tab without touching user tab state. */
export async function runDevelopmentMarkdownStreamInIsolatedTab(
  manager: DevelopmentMarkdownTabManager,
): Promise<Awaited<ReturnType<PiviChatDevelopmentCommands['run100KbMarkdownStream']>>> {
  const originalTabId = manager.getActiveTabId();
  if (!originalTabId) {
    throw new Error('An active chat tab is required for the Markdown performance stream.');
  }
  const tabId = `pivi-development-markdown-stream-${Date.now()}`;
  try {
    const tab = await manager.createTab(undefined, tabId);
    const ownerWindow = tab?.dom.messagesEl.ownerDocument.defaultView;
    if (!tab || tab.id !== tabId || !ownerWindow) {
      throw new Error('Failed to create the isolated Markdown performance tab.');
    }
    return await runDevelopmentMarkdownStream(tab.state, ownerWindow);
  } finally {
    if (manager.getTab(originalTabId)) {
      await manager.switchToTab(originalTabId);
    }
    if (manager.getTab(tabId)) {
      await manager.closeTab(tabId, true);
    }
  }
}

/** Runs one fixed projection shape through a disposable tab's real React surface. */
export async function runDevelopmentProjectionWorkload(
  manager: DevelopmentMarkdownTabManager,
  workload: DevelopmentProjectionWorkload,
  hooks: Parameters<NonNullable<PiviChatDevelopmentCommands['runProjectionWorkload']>>[1],
): Promise<Awaited<ReturnType<NonNullable<PiviChatDevelopmentCommands['runProjectionWorkload']>>>> {
  const originalTabId = manager.getActiveTabId();
  if (!originalTabId) {
    throw new Error('An active chat tab is required for the projection workload.');
  }
  const fixture = DEVELOPMENT_PROJECTION_WORKLOADS[workload];
  const tabId = `pivi-development-projection-${workload}-${Date.now()}`;
  try {
    const tab = await manager.createTab(undefined, tabId);
    const ownerWindow = tab?.dom.messagesEl.ownerDocument.defaultView;
    if (!tab || tab.id !== tabId || !ownerWindow) {
      throw new Error(`Failed to create the isolated ${workload} projection tab.`);
    }
    const state = tab.state as DevelopmentProjectionState;
    const message = cloneProjectionWorkloadMessage(workload);
    message.id = `${message.id}-${Date.now()}`;
    state.isStreaming = true;
    state.addMessage(message);
    await nextAnimationFrame(ownerWindow);
    await runProjectionEvents(
      workload,
      state,
      message,
      ownerWindow,
      1,
      DEVELOPMENT_PROJECTION_WARMUP_EVENTS,
    );

    const result = {
      workload,
      fixtureSha256: fixture.fixtureSha256,
      warmupEvents: DEVELOPMENT_PROJECTION_WARMUP_EVENTS,
      sampleEvents: DEVELOPMENT_PROJECTION_SAMPLE_EVENTS,
    };
    await hooks.beforeMeasurement(result);
    await runProjectionEvents(
      workload,
      state,
      message,
      ownerWindow,
      DEVELOPMENT_PROJECTION_WARMUP_EVENTS + 1,
      DEVELOPMENT_PROJECTION_SAMPLE_EVENTS,
    );
    await new Promise(resolve => ownerWindow.setTimeout(
      resolve,
      DEVELOPMENT_PROJECTION_SETTLE_MS,
    ));
    state.isStreaming = false;
    await hooks.afterMeasurement(result);
    return result;
  } finally {
    if (manager.getTab(originalTabId)) {
      await manager.switchToTab(originalTabId);
    }
    if (manager.getTab(tabId)) {
      await manager.closeTab(tabId, true);
    }
  }
}
