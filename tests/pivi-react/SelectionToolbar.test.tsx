import { fireEvent, render, screen } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { createI18n, I18nProvider } from '@pivi/pivi-react';
import { SelectionToolbar } from '@pivi/pivi-react/selectionToolbar';

import { withTestPresentationPlatform } from '../helpers/presentationPlatform';

function renderToolbar(overrides: Partial<ComponentProps<typeof SelectionToolbar>> = {}) {
  const onItem = jest.fn();
  const props = {
    items: [
      { id: 'inline-edit', label: 'Ask AI', kind: 'pivi-action' as const, icon: 'sparkles' },
      { id: 'add-to-chat', label: 'Add to chat', kind: 'pivi-action' as const, icon: 'message-square-plus' },
      {
        id: 'pivi-1',
        label: '/summarize',
        kind: 'pivi-command' as const,
        icon: 'scan-text',
      },
    ],
    onItem,
    ...overrides,
  };

  return {
    props,
    ...render(withTestPresentationPlatform(
      <I18nProvider i18n={createI18n()}>
        <SelectionToolbar {...props} />
      </I18nProvider>,
    )),
  };
}

describe('SelectionToolbar', () => {
  it('renders Ask AI, Add to chat, and shortcut buttons', () => {
    const { props } = renderToolbar();
    expect(screen.getAllByRole('button').map(button => button.getAttribute('aria-label'))).toEqual([
      'Ask AI',
      'Add to chat',
      '/summarize',
    ]);
    fireEvent.click(screen.getByRole('button', { name: 'Ask AI' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add to chat' }));
    fireEvent.click(screen.getByRole('button', { name: '/summarize' }));
    expect(
      screen.getByRole('button', { name: '/summarize' })
        .querySelector('[data-test-icon="scan-text"]'),
    ).not.toBeNull();
    expect(props.onItem).toHaveBeenNthCalledWith(1, 'inline-edit');
    expect(props.onItem).toHaveBeenNthCalledWith(2, 'add-to-chat');
    expect(props.onItem).toHaveBeenNthCalledWith(3, 'pivi-1');
  });

  it('renders no implicit actions', () => {
    renderToolbar({ items: [] });
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});
