import { fireEvent, render, screen } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { createI18n, I18nProvider } from '@pivi/pivi-react';
import { SelectionToolbar } from '@pivi/pivi-react/selectionToolbar';

import { withTestPresentationPlatform } from '../helpers/presentationPlatform';

function renderToolbar(overrides: Partial<ComponentProps<typeof SelectionToolbar>> = {}) {
  const props = {
    shortcuts: [
      {
        id: 'pivi-1',
        label: '/summarize',
        kind: 'pivi-command' as const,
        icon: 'scan-text',
      },
    ],
    onAskAi: jest.fn(),
    onAddToChat: jest.fn(),
    onShortcut: jest.fn(),
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
    fireEvent.click(screen.getByRole('button', { name: 'Ask AI' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add to chat' }));
    fireEvent.click(screen.getByRole('button', { name: '/summarize' }));
    expect(
      screen.getByRole('button', { name: '/summarize' })
        .querySelector('[data-test-icon="scan-text"]'),
    ).not.toBeNull();
    expect(props.onAskAi).toHaveBeenCalled();
    expect(props.onAddToChat).toHaveBeenCalled();
    expect(props.onShortcut).toHaveBeenCalledWith('pivi-1');
  });
});
