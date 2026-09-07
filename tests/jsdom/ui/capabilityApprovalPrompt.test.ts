import type { CapabilityApprovalRequest } from '@pivi/agent/ports';

import { showCapabilityApprovalPrompt } from '@/ui/chat/composer/capabilityApprovalPrompt';

describe('command capability approval prompt', () => {
  beforeEach(() => {
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      value: jest.fn(),
    });
  });

  afterEach(() => {
    document.body.innerHTML = '';
    Reflect.deleteProperty(HTMLElement.prototype, 'scrollIntoView');
  });

  it('shows the exact command id and supports the shared Always choice', async () => {
    const parent = document.body.createDiv();
    const input = parent.createDiv();
    const request: CapabilityApprovalRequest = {
      kind: 'obsidian-command',
      toolName: 'obsidian_command',
      commandId: 'workspace:split',
      blockedPath: 'workspace:split',
      reason: 'Obsidian command is not on the persistent permission list.',
      description: 'Execute Obsidian command: workspace:split',
    };

    const resultPromise = showCapabilityApprovalPrompt(
      {
        state: {} as never,
        renderer: {} as never,
        streamController: { hideThinkingIndicator: jest.fn() } as never,
        getInputContainerEl: () => input,
      },
      request,
      () => undefined,
      el => el.addClass('pivi-hidden'),
      el => el.removeClass('pivi-hidden'),
    );

    expect(parent.textContent).toContain('workspace:split');
    expect(parent.textContent).toContain('Deny');
    expect(parent.textContent).toContain('Allow once');
    expect(parent.textContent).toContain('Always allow');
    expect(input).toHaveClass('pivi-hidden');

    const always = [...parent.querySelectorAll<HTMLElement>('.pivi-ask-item')]
      .find(element => element.textContent?.includes('Always allow'));
    expect(always).toBeDefined();
    always?.click();

    await expect(resultPromise).resolves.toEqual({ decision: 'allow-always' });
    expect(input).not.toHaveClass('pivi-hidden');
  });
});
