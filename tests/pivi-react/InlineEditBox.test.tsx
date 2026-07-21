import { fireEvent, render, screen } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { createI18n, I18nProvider } from '@pivi/pivi-react';
import { InlineEditBox } from '@pivi/pivi-react/selectionToolbar';

import { withTestPresentationPlatform } from '../helpers/presentationPlatform';

const modelOptions = [{ value: 'gpt-test', label: 'GPT Test' }];
const thinkingOptions = [{ value: 'medium', label: 'Medium' }];

function renderInlineEdit(overrides: Partial<ComponentProps<typeof InlineEditBox>> = {}) {
  const props = {
    adaptiveReasoning: false,
    defaultReasoningValue: 'off',
    model: 'gpt-test',
    modelOptions,
    onAccept: jest.fn(),
    onCancel: jest.fn(),
    onModelChange: jest.fn(),
    onPromptChange: jest.fn(),
    onReject: jest.fn(),
    onSend: jest.fn(),
    onThinkingChange: jest.fn(),
    prompt: '',
    status: 'idle' as const,
    thinkingLevel: 'medium',
    thinkingOptions,
    ...overrides,
  };

  return {
    props,
    ...render(withTestPresentationPlatform(
      <I18nProvider i18n={createI18n()}>
        <InlineEditBox {...props} />
      </I18nProvider>,
    )),
  };
}

describe('InlineEditBox', () => {
  it('calls onSend when send is clicked', () => {
    const { props } = renderInlineEdit({ prompt: 'Rewrite this' });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(props.onSend).toHaveBeenCalled();
  });

  it('shows accept and reject when ready', () => {
    const { props } = renderInlineEdit({
      prompt: 'Rewrite this',
      resultPreview: 'Updated text',
      status: 'ready',
    });
    fireEvent.click(screen.getByRole('button', { name: 'Accept' }));
    fireEvent.click(screen.getByRole('button', { name: 'Reject' }));
    expect(props.onAccept).toHaveBeenCalled();
    expect(props.onReject).toHaveBeenCalled();
  });
});
