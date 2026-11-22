import type { CapabilityApprovalRequest } from '@pivi/agent/ports';
import { classifyBashCommand } from '@pivi/agent/tools';

import { showCapabilityApprovalPrompt } from '@/ui/chat/composer/capabilityApprovalPrompt';

function openPrompt(request: CapabilityApprovalRequest) {
  const parent = document.body.createDiv();
  const input = parent.createDiv();
  const result = showCapabilityApprovalPrompt(
    {
      state: {} as never,
      renderer: {} as never,
      streamController: { hideThinkingIndicator: jest.fn() } as never,
      getInputContainerEl: () => input,
    },
    request,
    () => undefined,
  );
  return { parent, input, result };
}

function openBashPrompt(command: string) {
  return openPrompt({
    kind: 'bash',
    toolName: 'bash',
    command,
    shellPath: '/bin/sh',
    bashClassification: classifyBashCommand(command),
    blockedPath: command,
    reason: 'Command is not on the persistent permission list.',
    description: `Run command: ${command}`,
  });
}

function pressKey(element: HTMLElement, key: string): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
  element.dispatchEvent(event);
  return event;
}

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
    const { parent, input, result } = openPrompt({
      kind: 'obsidian-command',
      toolName: 'obsidian_command',
      commandId: 'workspace:split',
      blockedPath: 'workspace:split',
      reason: 'Obsidian command is not on the persistent permission list.',
      description: 'Execute Obsidian command: workspace:split',
    });

    expect(parent.textContent).toContain('workspace:split');
    expect(parent.textContent).toContain('Deny');
    expect(parent.textContent).toContain('Allow once');
    expect(parent.textContent).toContain('Always allow');
    expect(input).not.toHaveClass('pivi-hidden');
    expect(input.previousElementSibling).toHaveClass('pivi-ask-capability-approval');

    const always = [...parent.querySelectorAll<HTMLElement>('.pivi-ask-item')]
      .find(element => element.textContent?.includes('Always allow'));
    expect(always).toBeDefined();
    always?.click();

    await expect(result).resolves.toEqual({ decision: 'allow-always' });
    expect(input).not.toHaveClass('pivi-hidden');
  });

  it('keeps an unsafe Always option disabled for pointer and keyboard input', async () => {
    const { parent, input, result } = openBashPrompt('echo qa > fixture.txt');
    const [deny, once, always] = parent.querySelectorAll<HTMLElement>('[role="button"]');
    expect(always).toHaveTextContent('Always allow');
    expect(always).toHaveAttribute('aria-disabled', 'true');
    expect(always?.tabIndex).toBe(-1);

    always!.click();
    deny!.focus();
    pressKey(deny!, '3');
    expect(input).not.toHaveClass('pivi-hidden');
    expect(input.previousElementSibling).toHaveClass('pivi-ask-capability-approval');
    expect(deny).toHaveFocus();

    pressKey(deny!, 'ArrowDown');
    pressKey(once!, 'ArrowDown');
    expect(once).toHaveFocus();
    pressKey(once!, ' ');

    await expect(result).resolves.toEqual({ decision: 'allow-once' });
    expect(input.previousElementSibling).toBeNull();
  });

  it('leaves scope selector keys to the native select', async () => {
    const { parent, input, result } = openBashPrompt('git status');
    const scope = parent.querySelector<HTMLSelectElement>('select')!;
    scope.focus();
    expect(pressKey(scope, 'ArrowDown').defaultPrevented).toBe(false);
    expect(pressKey(scope, 'Enter').defaultPrevented).toBe(false);
    expect(input).not.toHaveClass('pivi-hidden');
    expect(input.previousElementSibling).toHaveClass('pivi-ask-capability-approval');

    const deny = parent.querySelector<HTMLElement>('[role="button"]')!;
    deny.focus();
    pressKey(deny, 'Enter');
    await expect(result).resolves.toEqual({ decision: 'deny' });
  });
});
