import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const stylesRoot = join(process.cwd(), 'packages/pivi-react/styles');

describe('product design tokens', () => {
  const variables = readFileSync(join(stylesRoot, 'base/variables.css'), 'utf8');
  const accessibility = readFileSync(join(stylesRoot, 'accessibility.css'), 'utf8');
  const primitives = readFileSync(join(stylesRoot, 'base/presentation-primitives.css'), 'utf8');
  const modelSelector = readFileSync(join(stylesRoot, 'toolbar/model-selector.css'), 'utf8');
  const thinkingSelector = readFileSync(join(stylesRoot, 'toolbar/thinking-selector.css'), 'utf8');

  it('defines shared tokens on every presentation root', () => {
    expect(variables).toMatch(/\.pivi-container,\s*\.pivi-settings,\s*\.pivi-inline-edit-modal\s*\{/);
    for (const token of [
      '--pivi-radius-xs',
      '--pivi-shadow-popover-up-md',
      '--pivi-material-blur-lg',
      '--pivi-ease-out',
      '--pivi-duration-fast',
      '--pivi-surface-subtle',
      '--pivi-text-chat-body',
      '--pivi-text-composer',
      '--pivi-focus-ring',
      '--pivi-press-scale',
    ]) {
      expect(variables).toContain(`${token}:`);
    }
    expect(variables).toContain('--pivi-text-chat-body: var(--pivi-chat-font-size');
    expect(variables).toContain('--pivi-text-composer: var(--pivi-composer-font-size');
  });

  it('keeps focus rings independent from component geometry', () => {
    expect(accessibility).toContain('.pivi-settings-action-btn:focus-visible');
    expect(accessibility).toContain('.pivi-skill-choice:has(input:focus-visible)');
    expect(accessibility).not.toMatch(/focus-visible[^}]*border-radius:/s);
    expect(primitives).toContain('.pivi-toggle:has(input:focus-visible)');
  });

  it('uses the same press targets in default and reduced-motion rules', () => {
    for (const selector of [
      '.pivi-model-btn:active:not(:disabled)',
      '.pivi-thinking-current:active:not(:disabled)',
      '.pivi-external-context-btn:active:not(:disabled)',
      '.pivi-mode-selector:active:not(:disabled)',
      '.pivi-tab-switcher-item:active:not([aria-disabled=\'true\'])',
      '.pivi-slash-item:active:not([aria-disabled=\'true\'])',
      '.pivi-settings-action-btn:active:not(:disabled)',
      '.pivi-settings-text-btn:active:not(:disabled)',
      '.pivi-provider-header:active:not(:has(button:active))',
      '.pivi-hotkey-item:active:not(:disabled)',
      '.pivi-skill-choice:active:not(:has(input:disabled))',
      '.pivi-send-button:active:not(:disabled)',
      '.pivi-toggle:active:not(:has(input:disabled))',
    ]) {
      expect(primitives).toContain(selector);
      expect(accessibility).toContain(selector);
    }
  });

  it('blends selected model and thinking options into the menu until interaction', () => {
    expect(modelSelector).toMatch(/\.pivi-model-dropdown \.pivi-model-option\s*\{[^}]*background:\s*transparent;/s);
    expect(thinkingSelector).toMatch(/\.pivi-thinking-options \.pivi-thinking-gear\s*\{[^}]*background:\s*transparent;/s);
    expect(modelSelector).toMatch(/\.pivi-model-option\.selected\s*\{[^}]*background:\s*transparent;/s);
    expect(thinkingSelector).toMatch(/\.pivi-thinking-gear\.selected\s*\{[^}]*background:\s*transparent;/s);
    expect(modelSelector).toMatch(/\.pivi-model-option:hover\s*\{[^}]*background:\s*var\(--pivi-host-background-hover\);/s);
    expect(thinkingSelector).toMatch(/\.pivi-thinking-gear:hover\s*\{[^}]*background:\s*var\(--pivi-host-background-hover\);/s);
  });
});
