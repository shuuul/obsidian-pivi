import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const stylesRoot = join(process.cwd(), 'packages/pivi-react/styles');

describe('product design tokens', () => {
  const variables = readFileSync(join(stylesRoot, 'base/variables.css'), 'utf8');
  const accessibility = readFileSync(join(stylesRoot, 'accessibility.css'), 'utf8');
  const primitives = readFileSync(join(stylesRoot, 'base/presentation-primitives.css'), 'utf8');
  const input = readFileSync(join(stylesRoot, 'components/input.css'), 'utf8');
  const thinkingContent = readFileSync(join(stylesRoot, 'components/thinking.css'), 'utf8');
  const modelSelector = readFileSync(join(stylesRoot, 'toolbar/model-selector.css'), 'utf8');
  const thinkingSelector = readFileSync(join(stylesRoot, 'toolbar/thinking-selector.css'), 'utf8');
  const inlineEdit = readFileSync(join(stylesRoot, 'features/inline-edit-surface.css'), 'utf8');
  const markdown = readFileSync(join(stylesRoot, 'components/markdown-content.css'), 'utf8');

  it('defines shared tokens on every presentation root', () => {
    expect(variables).toMatch(
      /\.pivi-container,\s*\.pivi-settings,\s*\.pivi-selection-toolbar-overlay,\s*\.pivi-inline-selector-portal,\s*\.pivi-inline-edit-surface,\s*\.pivi-inline-edit-diff-review\s*\{/,
    );
    for (const token of [
      '--pivi-radius-xs',
      '--pivi-shadow-popover-up-md',
      '--pivi-material-blur-lg',
      '--pivi-ease-out',
      '--pivi-duration-fast',
      '--pivi-surface-subtle',
      '--pivi-flow-compact',
      '--pivi-flow-content',
      '--pivi-flow-section',
      '--pivi-text-chat-body',
      '--pivi-text-composer',
      '--pivi-focus-ring',
      '--pivi-press-scale',
    ]) {
      expect(variables).toContain(`${token}:`);
    }
    expect(variables).toContain('--pivi-text-chat-body: var(--pivi-chat-font-size');
    expect(variables).toContain('--pivi-text-composer: var(--pivi-composer-font-size');
    expect(variables).toMatch(
      /\.pivi-inline-composer-selector-portal \{[\s\S]*?font-family: var\(--pivi-host-font-text\);[\s\S]*?font-size: var\(--pivi-text-base\);/,
    );
    expect(variables).toMatch(
      /\.pivi-inline-composer-selector-portal \{[\s\S]*?z-index: var\(--pivi-z-inline-portal\);[\s\S]*?pointer-events: none;/,
    );
    expect(variables).toMatch(
      /body \{[\s\S]*?--pivi-z-settings-popover: 20;[\s\S]*?--pivi-z-inline-portal: 10004;[\s\S]*?\}/,
    );
  });

  it('keeps focus rings independent from component geometry', () => {
    expect(accessibility).toContain('.pivi-settings-action-btn:focus-visible');
    expect(accessibility).toContain('.pivi-skill-choice:focus-within');
    expect(accessibility).not.toMatch(/focus-visible[^}]*border-radius:/s);
    expect(primitives).toContain('.pivi-toggle:focus-within');
    expect(primitives).not.toContain(':has(');
    expect(accessibility).not.toContain(':has(');
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
      '.pivi-provider-header:active',
      '.pivi-hotkey-item:active:not(:disabled)',
      '.pivi-skill-choice:active',
      '.pivi-send-button:active:not(:disabled)',
      '.pivi-toggle:not(.pivi-toggle--disabled):active',
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

  it('keeps selected model and thinking typography consistent with their menu options', () => {
    expect(modelSelector).toMatch(/\.pivi-model-btn\s*\{[^}]*font-family:\s*var\(--pivi-host-font-interface, inherit\);[^}]*font-size:\s*var\(--pivi-text-sm\);/s);
    expect(modelSelector).toMatch(/\.pivi-model-dropdown \.pivi-model-option\s*\{[^}]*font-family:\s*var\(--pivi-host-font-interface, inherit\);[^}]*font-size:\s*var\(--pivi-text-sm\);/s);
    expect(thinkingSelector).toMatch(/\.pivi-thinking-current\s*\{[^}]*font-family:\s*var\(--pivi-host-font-interface, inherit\);[^}]*font-size:\s*var\(--pivi-text-xs\);/s);
    expect(thinkingSelector).toMatch(/\.pivi-thinking-options \.pivi-thinking-gear\s*\{[^}]*font-family:\s*var\(--pivi-host-font-interface, inherit\);[^}]*font-size:\s*var\(--pivi-text-xs\);/s);
    expect(input).toMatch(/\.pivi-container \.pivi-input-toolbar > \.pivi-model-selector > \.pivi-model-btn,\s*\.pivi-container \.pivi-input-toolbar \.pivi-thinking-current\s*\{[^}]*font-family:\s*var\(--pivi-host-font-interface, inherit\);/s);
    expect(inlineEdit).toMatch(/\.pivi-inline-edit-surface \.pivi-thinking-current\s*\{[^}]*font-size:\s*var\(--pivi-text-xs\);/s);
    expect(thinkingContent).toMatch(/\.pivi-thinking-header \.pivi-thinking-label\s*\{/);
    expect(thinkingContent).not.toMatch(/(^|\})\s*\.pivi-thinking-label\s*\{/);
  });

  it('uses the Sidebar output scale and text boundary for inline diff Markdown', () => {
    expect(markdown).toMatch(
      /:is\([^}]*\.pivi-inline-edit-diff-review-content\.pivi-markdown-rendered[^}]*\)\s*\{[^}]*--font-text-size:\s*var\(--pivi-text-chat-body\);[^}]*font-size:\s*var\(--font-text-size\);[^}]*line-height:\s*var\(--pivi-chat-line-height, 1\.4\);/s,
    );
    expect(markdown).toContain(') :is(p, li, table, th, td)');
    expect(inlineEdit).toMatch(
      /\.pivi-inline-edit-diff-review-content\s*\{[^}]*font-family:\s*var\(--pivi-host-font-text, inherit\);[^}]*white-space:\s*normal;[^}]*word-break:\s*normal;[^}]*line-break:\s*auto;[^}]*tab-size:\s*8;[^}]*caret-color:\s*auto;/s,
    );
    expect(inlineEdit).not.toMatch(
      /\.pivi-inline-edit-diff-review-deletion\s*\{[^}]*text-decoration:/s,
    );
    expect(inlineEdit).toMatch(
      /\.pivi-inline-edit-diff-review-shortcut\s*\{[^}]*display:\s*inline-flex;[^}]*align-items:\s*center;[^}]*font-size:\s*1em;[^}]*line-height:\s*1;/s,
    );
    expect(inlineEdit).toMatch(
      /\.pivi-inline-edit-surface-input\.pivi-rich-input\s*\{[^}]*font-size:\s*var\(--pivi-text-composer\);/s,
    );
    expect(inlineEdit).toMatch(
      /\.pivi-inline-edit-surface \.pivi-inline-edit-surface-send,[\s\S]*?\.pivi-inline-edit-surface \.pivi-inline-edit-surface-send:disabled\s*\{[^}]*background:\s*transparent;[^}]*box-shadow:\s*none;/s,
    );
    expect(inlineEdit).toMatch(
      /\.pivi-inline-edit-surface \.pivi-inline-edit-surface-send--stop,[\s\S]*?\.pivi-inline-edit-surface \.pivi-inline-edit-surface-send--stop:active\s*\{[^}]*background:\s*transparent;[^}]*box-shadow:\s*none;/s,
    );
  });
});
