import type { ChatMessage } from '@pivi/pivi-agent-core/foundation';

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
const DEVELOPMENT_SWITCHING_MESSAGE_COUNT = 100;
const DEVELOPMENT_SWITCHING_PASSES = 2;
const DEVELOPMENT_SWITCHING_TAB_COUNT = 10;

type DevelopmentMarkdownStreamState = {
  messages: ChatMessage[];
  isStreaming: boolean;
  addMessage(message: ChatMessage): void;
  notifyMessageChanged(message: ChatMessage): void;
  flushProjection(): void;
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