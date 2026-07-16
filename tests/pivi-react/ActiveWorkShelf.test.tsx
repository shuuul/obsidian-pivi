import type { ChatMessage, SubagentInfo } from '@pivi/pivi-agent-core/foundation';
import { fireEvent, render, screen, within } from '@testing-library/react';
import type { ReactElement } from 'react';

import { createI18n, I18nProvider } from '@pivi/pivi-react';
import { ActiveChatUiBridge } from '@pivi/pivi-react/mount';
import {
  ChatProjectionStore,
  createInitialChatUiSnapshot,
} from '@pivi/pivi-react/store';

import { ActiveWorkShelf } from '../../packages/pivi-react/src/mount/composer/ActiveWorkShelf';
import { ComposerChrome } from '../../packages/pivi-react/src/mount/composer/ComposerChrome';
import { withTestPresentationPlatform } from '../helpers/presentationPlatform';

const composerActions = {
  send: jest.fn(),
  stop: jest.fn(),
  setModel: jest.fn(),
  setMode: jest.fn(),
  setThinkingBudget: jest.fn(),
  setThinkingLevel: jest.fn(),
  toggleExternalPath: jest.fn(),
  toggleExternalPinned: jest.fn(),
  removeExternalPath: jest.fn(),
  addExternalContext: jest.fn(),
};

function renderWithProviders(ui: ReactElement) {
  return render(withTestPresentationPlatform(
    <I18nProvider i18n={createI18n()}>{ui}</I18nProvider>,
  ));
}

function subagent(overrides: Partial<SubagentInfo>): SubagentInfo {
  return {
    id: 'run',
    description: 'Background task',
    isExpanded: false,
    mode: 'async',
    status: 'running',
    toolCalls: [],
    ...overrides,
  };
}

function agentMessage(
  messageId: string,
  run: SubagentInfo,
): ChatMessage {
  return {
    id: messageId,
    role: 'assistant',
    content: '',
    timestamp: 1,
    toolCalls: [{
      id: `spawn-${run.id}`,
      name: 'spawn_agent',
      input: {},
      status: run.status === 'completed' ? 'completed' : 'running',
      subagent: run,
    }],
  };
}

describe('ActiveWorkShelf', () => {
  it('stays off by default and stays hidden when enabled without active work', () => {
    const store = new ChatProjectionStore();
    store.replaceAll([agentMessage('owner-active', subagent({
      id: 'active-run',
      writerName: 'Ada',
    }))]);
    const run = store.getAgentRunSnapshot('active-run');
    expect(run).not.toBeNull();
    if (!run) return;

    const initialSnapshot = createInitialChatUiSnapshot();
    const view = renderWithProviders(
      <ComposerChrome
        actions={composerActions}
        activeWorkItems={[{ run, tabId: 'tab-a' }]}
        onNavigateToWork={jest.fn()}
        snapshot={initialSnapshot}
      />,
    );

    expect(screen.queryByRole('region', { name: 'Active work' })).not.toBeInTheDocument();

    view.rerender(withTestPresentationPlatform(
      <I18nProvider i18n={createI18n()}>
        <ComposerChrome
          actions={composerActions}
          activeWorkItems={[]}
          onNavigateToWork={jest.fn()}
          snapshot={{
            ...initialSnapshot,
            composer: { ...initialSnapshot.composer, showActiveWorkShelf: true },
          }}
        />
      </I18nProvider>,
    ));

    expect(screen.queryByRole('region', { name: 'Active work' })).not.toBeInTheDocument();
  });

  it('shows active top-level background runs from every tab with their lifecycle status', () => {
    const firstTab = new ChatProjectionStore();
    const secondTab = new ChatProjectionStore();
    const child = subagent({
      id: 'child-run',
      writerName: 'Child',
    });
    firstTab.replaceAll([
      agentMessage('owner-queued', subagent({
        activityStatus: 'queued',
        asyncStatus: 'pending',
        id: 'queued-run',
        writerName: 'Ada',
      })),
      agentMessage('owner-parent', subagent({
        id: 'parent-run',
        toolCalls: [{
          id: 'spawn-child-run',
          input: {},
          name: 'spawn_agent',
          status: 'running',
          subagent: child,
        }],
        writerName: 'Lin',
      })),
      agentMessage('owner-sync', subagent({
        id: 'sync-run',
        mode: 'sync',
        writerName: 'Foreground',
      })),
    ]);
    secondTab.replaceAll([agentMessage('owner-waiting', subagent({
      activityStatus: 'waiting',
      id: 'waiting-run',
      writerName: 'Grace',
    }))]);
    const bridge = new ActiveChatUiBridge();
    const navigate = jest.fn();
    bridge.setActiveWorkShelfSources([
      { store: firstTab, tabId: 'tab-a' },
      { store: secondTab, tabId: 'tab-b' },
    ], navigate);

    renderWithProviders(
      <ActiveWorkShelf
        items={bridge.getActiveWorkShelfSnapshot()}
        onNavigate={navigate}
      />,
    );

    const shelf = screen.getByRole('region', { name: 'Active work' });
    const ada = within(shelf).getByRole('button', { name: 'Go to Ada in the transcript' });
    const lin = within(shelf).getByRole('button', { name: 'Go to Lin in the transcript' });
    const grace = within(shelf).getByRole('button', { name: 'Go to Grace in the transcript' });
    expect(within(ada).getByText('Queued')).toBeInTheDocument();
    expect(within(lin).getByText('Running')).toBeInTheDocument();
    expect(within(grace).getByText('Waiting')).toBeInTheDocument();
    expect(within(shelf).queryByText('Child')).not.toBeInTheDocument();
    expect(within(shelf).queryByText('Foreground')).not.toBeInTheDocument();

    fireEvent.click(grace);
    expect(navigate).toHaveBeenCalledWith('tab-b', 'owner-waiting');

    bridge.dispose();
  });

  it('removes a run after it reaches a terminal lifecycle state', () => {
    const store = new ChatProjectionStore();
    const active = subagent({
      id: 'run-to-complete',
      writerName: 'Austen',
    });
    store.replaceAll([agentMessage('owner-terminal', active)]);
    const bridge = new ActiveChatUiBridge();
    bridge.setActiveWorkShelfSources([{ store, tabId: 'tab-a' }], jest.fn());
    const view = renderWithProviders(
      <ActiveWorkShelf
        items={bridge.getActiveWorkShelfSnapshot()}
        onNavigate={jest.fn()}
      />,
    );
    expect(screen.getByRole('region', { name: 'Active work' })).toBeInTheDocument();

    store.upsertNow(agentMessage('owner-terminal', {
      ...active,
      activityStatus: 'completed',
      asyncStatus: 'completed',
      status: 'completed',
    }));
    view.rerender(withTestPresentationPlatform(
      <I18nProvider i18n={createI18n()}>
        <ActiveWorkShelf
          items={bridge.getActiveWorkShelfSnapshot()}
          onNavigate={jest.fn()}
        />
      </I18nProvider>,
    ));

    expect(screen.queryByRole('region', { name: 'Active work' })).not.toBeInTheDocument();
    bridge.dispose();
  });
});
