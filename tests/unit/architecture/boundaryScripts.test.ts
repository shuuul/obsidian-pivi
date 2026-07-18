import { execFileSync, spawnSync } from 'child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const rootDir = process.cwd();
const architectureScript = join(rootDir, 'scripts/check-architecture-boundaries.mjs');

function runArchitectureCheck(cwd: string) {
  return spawnSync(process.execPath, [architectureScript], {
    cwd,
    encoding: 'utf8',
  });
}

function createPortableLocaleFixture() {
  return {
    settings: {
      modelsTab: {
        apiKeyDesc: 'Saved in {secureStorageName}.',
        apiKeyOptionalDesc: 'Optionally saved in {secureStorageName}.',
        apiKeySavedPlaceholder: 'Saved in {secureStorageName}',
        codex: { desc: 'Credentials are stored in {secureStorageName}.' },
        intro: 'Credentials are stored in {secureStorageName}.',
        oauthTokenDesc: 'Saved in {secureStorageName}.',
        oauthTokenSavedPlaceholder: 'Saved in {secureStorageName}',
        secureStorageRequired: '{hostName} requires {secureStorageName}.',
      },
      skills: {
        defaultBundle: {
          desc: 'Install in this {workspaceName}.',
          name: 'Default {hostName} skills',
        },
      },
      slashCommands: { desc: 'Commands for this {workspaceName}.' },
      tools: { intro: 'Enable {hostName} tools.' },
      webSearch: {
        apiKeySavedPlaceholder: 'Saved in {secureStorageName}',
      },
    },
  };
}

describe('architecture boundary scripts', () => {
  it('passes import boundary checks', () => {
    expect(() => {
      execFileSync('node', ['scripts/check-architecture-boundaries.mjs'], {
        cwd: rootDir,
        stdio: 'pipe',
      });
    }).not.toThrow();
  });

  it('passes package README coverage checks', () => {
    expect(() => {
      execFileSync('node', ['scripts/check-package-readmes.mjs'], {
        cwd: rootDir,
        stdio: 'pipe',
      });
    }).not.toThrow();
  });

  it.each([
    'plugin.getUiFacades();',
    'plugin?.getUiFacades();',
    "plugin['getUiFacades']();",
    'const facadeFactory = plugin.getUiFacades; facadeFactory();',
    'const { getUiFacades } = plugin; getUiFacades();',
    'getUiFacades();',
    'plugin.getPiWorkspace();',
    'plugin?.saveSettings();',
    "plugin['getAllViews']();",
  ])('rejects src/ui plugin capability bypasses: %s', (source) => {
    const fixtureRoot = mkdtempSync(join(tmpdir(), 'pivi-boundary-'));
    try {
      mkdirSync(join(fixtureRoot, 'src/ui'), { recursive: true });
      writeFileSync(join(fixtureRoot, 'src/ui/fixture.ts'), source);

      const result = runArchitectureCheck(fixtureRoot);

      expect(result.status).toBe(1);
      expect(result.stderr).toContain(
        '[src/ui uses injected ChatPorts instead of plugin capability bypasses]',
      );
      expect(result.stderr).toContain('src/ui/fixture.ts:1');
    } finally {
      rmSync(fixtureRoot, { recursive: true, force: true });
    }
  });

  it.each([
    "export { getUiFacades } from '@/app/workspace';",
    "export { getUiFacades as workspace } from '@/app/workspace';",
  ])('rejects src/ui re-exports of plugin capability bypasses: %s', (source) => {
    const fixtureRoot = mkdtempSync(join(tmpdir(), 'pivi-boundary-'));
    try {
      mkdirSync(join(fixtureRoot, 'src/ui'), { recursive: true });
      writeFileSync(join(fixtureRoot, 'src/ui/fixture.ts'), source);

      const result = runArchitectureCheck(fixtureRoot);

      expect(result.status).toBe(1);
      expect(result.stderr).toContain(
        '[src/ui uses injected ChatPorts instead of plugin capability bypasses]',
      );
      expect(result.stderr).toContain('re-exports forbidden capability "getUiFacades"');
    } finally {
      rmSync(fixtureRoot, { recursive: true, force: true });
    }
  });

  it('allows facade calls inside app composition', () => {
    const fixtureRoot = mkdtempSync(join(tmpdir(), 'pivi-boundary-'));
    try {
      mkdirSync(join(fixtureRoot, 'src/app/ui'), { recursive: true });
      writeFileSync(
        join(fixtureRoot, 'src/app/ui/fixture.ts'),
        'plugin.getUiFacades();',
      );

      const result = runArchitectureCheck(fixtureRoot);

      expect(result.status).toBe(0);
    } finally {
      rmSync(fixtureRoot, { recursive: true, force: true });
    }
  });

  it.each([
    ['src/app/ui', 'src does not reference the retired React package identity'],
    ['packages/example/src', 'packages do not reference the retired React package identity'],
  ])('rejects the retired React package name from %s', (fixtureDir, ruleName) => {
    const fixtureRoot = mkdtempSync(join(tmpdir(), 'pivi-boundary-'));
    try {
      mkdirSync(join(fixtureRoot, fixtureDir), { recursive: true });
      const retiredPackageName = ['@pivi/obsidian', 'ui'].join('-');
      writeFileSync(
        join(fixtureRoot, fixtureDir, 'fixture.ts'),
        `import { mountChatView } from '${retiredPackageName}/mount';`,
      );

      const result = runArchitectureCheck(fixtureRoot);

      expect(result.status).toBe(1);
      expect(result.stderr).toContain(`[${ruleName}]`);
    } finally {
      rmSync(fixtureRoot, { recursive: true, force: true });
    }
  });

  it('allows React surface mounts only inside src/app/ui', () => {
    const fixtureRoot = mkdtempSync(join(tmpdir(), 'pivi-boundary-'));
    try {
      mkdirSync(join(fixtureRoot, 'src/app/feature'), { recursive: true });
      writeFileSync(
        join(fixtureRoot, 'src/app/feature/fixture.ts'),
        "import { mountChatView } from '@pivi/pivi-react/mount';",
      );

      const result = runArchitectureCheck(fixtureRoot);

      expect(result.status).toBe(1);
      expect(result.stderr).toContain(
        '[only src/app/ui mounts @pivi/pivi-react surfaces]',
      );
    } finally {
      rmSync(fixtureRoot, { recursive: true, force: true });
    }
  });

  it.each([
    [
      'runtime barrel',
      "import type { ChatPorts } from '@pivi/pivi-agent-core/runtime';",
    ],
    [
      'chatPorts leaf',
      "import type { ChatPorts } from '@pivi/pivi-agent-core/runtime/chatPorts';",
    ],
    [
      'core root namespace',
      "import type { runtime } from '@pivi/pivi-agent-core'; type Leaked = runtime.ChatPorts;",
    ],
  ])('rejects ChatPorts-capable imports from the React package via %s', (_label, source) => {
    const fixtureRoot = mkdtempSync(join(tmpdir(), 'pivi-boundary-'));
    try {
      mkdirSync(join(fixtureRoot, 'packages/pivi-react/src'), { recursive: true });
      writeFileSync(
        join(fixtureRoot, 'packages/pivi-react/src/fixture.ts'),
        source,
      );

      const result = runArchitectureCheck(fixtureRoot);

      expect(result.status).toBe(1);
      expect(result.stderr).toContain(
        '[@pivi/pivi-react stays presentation-only and product-neutral]',
      );
      expect(result.stderr).toContain('packages/pivi-react/src/fixture.ts:1');
    } finally {
      rmSync(fixtureRoot, { recursive: true, force: true });
    }
  });

  it('allows non-chat runtime contracts needed by React presentation adapters', () => {
    const fixtureRoot = mkdtempSync(join(tmpdir(), 'pivi-boundary-'));
    try {
      mkdirSync(join(fixtureRoot, 'packages/pivi-react/src'), { recursive: true });
      writeFileSync(
        join(fixtureRoot, 'packages/pivi-react/src/fixture.ts'),
        "import type { AuxQueryRunner } from '@pivi/pivi-agent-core/runtime/auxQueryRunner';",
      );

      const result = runArchitectureCheck(fixtureRoot);

      expect(result.status).toBe(0);
    } finally {
      rmSync(fixtureRoot, { recursive: true, force: true });
    }
  });

  it.each([
    'view.getTabManager();',
    'view?.getActiveTab();',
    'tab.controllers.inputController.cancelStreaming();',
    'tab.state.isStreaming = false;',
    'tab.dom.messagesEl.empty();',
    'tab.ui.inlineContextManager.addSelectionFromEditor(editor, view);',
    "tab.ui['externalContextSelector'].getExternalContexts();",
    "import { TabManager } from '@/ui/chat/tabs/TabManager';",
    "import type { TabData } from '@/ui/chat/tabs/types';",
  ])('rejects app-side chat aggregate inspection: %s', (source) => {
    const fixtureRoot = mkdtempSync(join(tmpdir(), 'pivi-boundary-'));
    try {
      mkdirSync(join(fixtureRoot, 'src/app'), { recursive: true });
      writeFileSync(join(fixtureRoot, 'src/app/fixture.ts'), source);

      const result = runArchitectureCheck(fixtureRoot);

      expect(result.status).toBe(1);
      expect(result.stderr).toContain('src/app/fixture.ts:1');
    } finally {
      rmSync(fixtureRoot, { recursive: true, force: true });
    }
  });

  it('allows chat aggregate access inside the imperative adapter boundary', () => {
    const fixtureRoot = mkdtempSync(join(tmpdir(), 'pivi-boundary-'));
    try {
      mkdirSync(join(fixtureRoot, 'src/app/ui'), { recursive: true });
      writeFileSync(
        join(fixtureRoot, 'src/app/ui/imperativeChatAdapter.ts'),
        'tabManager.getActiveTab()?.controllers.inputController?.cancelStreaming();',
      );

      const result = runArchitectureCheck(fixtureRoot);

      expect(result.status).toBe(0);
    } finally {
      rmSync(fixtureRoot, { recursive: true, force: true });
    }
  });

  it('allows unrelated app state and DOM properties', () => {
    const fixtureRoot = mkdtempSync(join(tmpdir(), 'pivi-boundary-'));
    try {
      mkdirSync(join(fixtureRoot, 'src/app'), { recursive: true });
      writeFileSync(
        join(fixtureRoot, 'src/app/fixture.ts'),
        'workspace.state.ready; settings.dom.selector;',
      );

      const result = runArchitectureCheck(fixtureRoot);

      expect(result.status).toBe(0);
    } finally {
      rmSync(fixtureRoot, { recursive: true, force: true });
    }
  });

  it.each([
    "import { ChatUiStore } from '@pivi/pivi-react';",
    "import type { ChatUiSnapshot } from '@pivi/pivi-react';",
    "import { parseMessageMentions } from '@pivi/pivi-react/mentions';",
    "import { recalculateUsageForModel } from '@pivi/pivi-react/usage';",
    "import { mountChatView } from '@pivi/pivi-react/mount';",
    "import type { ChatPresentationPort } from '@pivi/pivi-react/ports';",
    "void import('@pivi/pivi-react');",
    "require('@pivi/pivi-react/internal');",
  ])('rejects non-presentation React package edges from src/ui: %s', (source) => {
    const fixtureRoot = mkdtempSync(join(tmpdir(), 'pivi-boundary-'));
    try {
      mkdirSync(join(fixtureRoot, 'src/ui'), { recursive: true });
      writeFileSync(join(fixtureRoot, 'src/ui/fixture.ts'), source);

      const result = runArchitectureCheck(fixtureRoot);

      expect(result.status).toBe(1);
      expect(result.stderr).toContain(
        '[src/ui uses only approved @pivi/pivi-react presentation subpaths]',
      );
    } finally {
      rmSync(fixtureRoot, { recursive: true, force: true });
    }
  });

  it.each([
    '@pivi/pivi-react/store',
    '@pivi/pivi-react/context-badges',
  ])('allows the approved React presentation subpath: %s', (moduleName) => {
    const fixtureRoot = mkdtempSync(join(tmpdir(), 'pivi-boundary-'));
    try {
      mkdirSync(join(fixtureRoot, 'src/ui'), { recursive: true });
      writeFileSync(
        join(fixtureRoot, 'src/ui/fixture.ts'),
        `import type { PresentationContract } from '${moduleName}';`,
      );

      const result = runArchitectureCheck(fixtureRoot);

      expect(result.status).toBe(0);
    } finally {
      rmSync(fixtureRoot, { recursive: true, force: true });
    }
  });

  it('rejects a relative-path bypass into the React package', () => {
    const fixtureRoot = mkdtempSync(join(tmpdir(), 'pivi-boundary-'));
    try {
      mkdirSync(join(fixtureRoot, 'src/ui'), { recursive: true });
      mkdirSync(join(fixtureRoot, 'packages/pivi-react/src'), { recursive: true });
      writeFileSync(
        join(fixtureRoot, 'src/ui/fixture.ts'),
        "import '../../packages/pivi-react/src/index';",
      );

      const result = runArchitectureCheck(fixtureRoot);

      expect(result.status).toBe(1);
      expect(result.stderr).toContain(
        '[src/ui uses only approved @pivi/pivi-react presentation subpaths]',
      );
    } finally {
      rmSync(fixtureRoot, { recursive: true, force: true });
    }
  });

  it.each([
    ['packages/obsidian-host/src', '@pivi/obsidian-host stays host-only'],
    ['packages/obsidian-tools/src', '@pivi/obsidian-tools does not import raw Pi SDKs'],
  ])('rejects React presentation imports from %s', (fixtureDir, ruleName) => {
    const fixtureRoot = mkdtempSync(join(tmpdir(), 'pivi-boundary-'));
    try {
      mkdirSync(join(fixtureRoot, fixtureDir), { recursive: true });
      writeFileSync(
        join(fixtureRoot, fixtureDir, 'fixture.ts'),
        "import { ChatShell } from '@pivi/pivi-react';",
      );

      const result = runArchitectureCheck(fixtureRoot);

      expect(result.status).toBe(1);
      expect(result.stderr).toContain(`[${ruleName}]`);
    } finally {
      rmSync(fixtureRoot, { recursive: true, force: true });
    }
  });

  it('rejects direct Obsidian imports from the React presentation package', () => {
    const fixtureRoot = mkdtempSync(join(tmpdir(), 'pivi-boundary-'));
    try {
      mkdirSync(join(fixtureRoot, 'packages/pivi-react/src'), { recursive: true });
      writeFileSync(
        join(fixtureRoot, 'packages/pivi-react/src/fixture.ts'),
        "import { setIcon } from 'obsidian';",
      );

      const result = runArchitectureCheck(fixtureRoot);

      expect(result.status).toBe(1);
      expect(result.stderr).toContain(
        '[@pivi/pivi-react stays presentation-only and product-neutral]',
      );
    } finally {
      rmSync(fixtureRoot, { recursive: true, force: true });
    }
  });

  it.each([
    "import { createPluginServiceGraph } from '@/app/serviceGraph';",
    "import '../app/serviceGraph';",
    "import { PiviChatHost } from '@/app/hostContracts';",
  ])('rejects unapproved src/ui to app imports: %s', (source) => {
    const fixtureRoot = mkdtempSync(join(tmpdir(), 'pivi-boundary-'));
    try {
      mkdirSync(join(fixtureRoot, 'src/ui'), { recursive: true });
      mkdirSync(join(fixtureRoot, 'src/app'), { recursive: true });
      writeFileSync(join(fixtureRoot, 'src/ui/fixture.ts'), source);
      writeFileSync(join(fixtureRoot, 'src/app/serviceGraph.ts'), 'export {};');

      const result = runArchitectureCheck(fixtureRoot);

      expect(result.status).toBe(1);
      expect(result.stderr).toContain('[src/ui imports only approved app seams]');
    } finally {
      rmSync(fixtureRoot, { recursive: true, force: true });
    }
  });

  it.each([
    "import { t } from '@/app/i18n';",
    "import { getVaultPath } from '@/app/hostPlatform';",
    "import type { PiviChatHost } from '@/app/hostContracts';",
  ])('allows the approved src/ui to app seam: %s', (source) => {
    const fixtureRoot = mkdtempSync(join(tmpdir(), 'pivi-boundary-'));
    try {
      mkdirSync(join(fixtureRoot, 'src/ui'), { recursive: true });
      writeFileSync(join(fixtureRoot, 'src/ui/fixture.ts'), source);

      const result = runArchitectureCheck(fixtureRoot);

      expect(result.status).toBe(0);
    } finally {
      rmSync(fixtureRoot, { recursive: true, force: true });
    }
  });

  it('rejects tests that reach product src through relative paths', () => {
    const fixtureRoot = mkdtempSync(join(tmpdir(), 'pivi-boundary-'));
    try {
      mkdirSync(join(fixtureRoot, 'tests/unit'), { recursive: true });
      mkdirSync(join(fixtureRoot, 'src'), { recursive: true });
      writeFileSync(join(fixtureRoot, 'tests/unit/fixture.ts'), "import '../../src/main';");
      writeFileSync(join(fixtureRoot, 'src/main.ts'), 'export {};');

      const result = runArchitectureCheck(fixtureRoot);

      expect(result.status).toBe(1);
      expect(result.stderr).toContain(
        '[tests must not import product src/** relative paths into src/]',
      );
    } finally {
      rmSync(fixtureRoot, { recursive: true, force: true });
    }
  });

  it('allows tests to use the configured product alias', () => {
    const fixtureRoot = mkdtempSync(join(tmpdir(), 'pivi-boundary-'));
    try {
      mkdirSync(join(fixtureRoot, 'tests/unit'), { recursive: true });
      writeFileSync(
        join(fixtureRoot, 'tests/unit/fixture.ts'),
        "import { createPluginServiceGraph } from '@/app/serviceGraph';",
      );

      const result = runArchitectureCheck(fixtureRoot);

      expect(result.status).toBe(0);
    } finally {
      rmSync(fixtureRoot, { recursive: true, force: true });
    }
  });

  it('rejects the retired React identity from package manifests', () => {
    const fixtureRoot = mkdtempSync(join(tmpdir(), 'pivi-boundary-'));
    try {
      mkdirSync(join(fixtureRoot, 'packages/example'), { recursive: true });
      const retiredPackageName = ['@pivi/obsidian', 'ui'].join('-');
      writeFileSync(
        join(fixtureRoot, 'packages/example/package.json'),
        JSON.stringify({ dependencies: { [retiredPackageName]: '*' }, name: '@pivi/example' }),
      );

      const result = runArchitectureCheck(fixtureRoot);

      expect(result.status).toBe(1);
      expect(result.stderr).toContain(
        '[package manifests do not reference the retired React package identity]',
      );
    } finally {
      rmSync(fixtureRoot, { recursive: true, force: true });
    }
  });

  it('rejects direct host theme variables from pivi-react CSS', () => {
    const fixtureRoot = mkdtempSync(join(tmpdir(), 'pivi-boundary-'));
    try {
      mkdirSync(join(fixtureRoot, 'packages/pivi-react/styles'), { recursive: true });
      writeFileSync(
        join(fixtureRoot, 'packages/pivi-react/styles/fixture.css'),
        '.link { color: var(--new-obsidian-token); }',
      );

      const result = runArchitectureCheck(fixtureRoot);

      expect(result.status).toBe(1);
      expect(result.stderr).toContain(
        '[@pivi/pivi-react CSS uses only --pivi-* or locally defined variables]',
      );
      expect(result.stderr).toContain('packages/pivi-react/styles/fixture.css:1');
    } finally {
      rmSync(fixtureRoot, { force: true, recursive: true });
    }
  });

  it.each([
    [
      'JSX className',
      '<div className="setting-item-control" />;',
      '@pivi/pivi-react JSX uses product-owned CSS classes',
    ],
    [
      'host terminology in a class',
      '<div className="pivi-vault-folder" />;',
      '@pivi/pivi-react JSX uses product-owned CSS classes',
    ],
    [
      'DOM setAttribute',
      "element.setAttribute('class', 'modal-container pivi-shell');",
      '@pivi/pivi-react DOM adapters use product-owned CSS classes',
    ],
    [
      'DOM classList',
      "element.classList.add('checkbox-container');",
      '@pivi/pivi-react DOM adapters use product-owned CSS classes',
    ],
    [
      'JSX template literal',
      '<div className={`pivi-shell modal-container ${active ? "is-active" : ""}`} />;',
      '@pivi/pivi-react JSX uses product-owned CSS classes',
    ],
    [
      'JSX concatenated literal',
      "<div className={'modal-' + 'container'} />;",
      '@pivi/pivi-react JSX uses product-owned CSS classes',
    ],
    [
      'DOM className assignment',
      "element.className = 'modal-content';",
      '@pivi/pivi-react DOM adapters use product-owned CSS classes',
    ],
    [
      'DOM className append',
      'element.className += ` mod-muted ${active ? "pivi-active" : ""}`;',
      '@pivi/pivi-react DOM adapters use product-owned CSS classes',
    ],
  ])('rejects Obsidian DOM classes from pivi-react %s', (_label, source, ruleName) => {
    const fixtureRoot = mkdtempSync(join(tmpdir(), 'pivi-boundary-'));
    try {
      mkdirSync(join(fixtureRoot, 'packages/pivi-react/src'), { recursive: true });
      writeFileSync(join(fixtureRoot, 'packages/pivi-react/src/fixture.tsx'), source);

      const result = runArchitectureCheck(fixtureRoot);

      expect(result.status).toBe(1);
      expect(result.stderr).toContain(`[${ruleName}]`);
    } finally {
      rmSync(fixtureRoot, { force: true, recursive: true });
    }
  });

  it.each([
    '.setting-item-heading .pivi-control { color: red; }',
    '.modal, .modal-bg { display: none; }',
    '.theme-dark .svg-icon { color: white; }',
    '.modal-close-button, .mod-muted { opacity: 0.5; }',
    '@media (width > 600px) { .modal-title { display: block; } }',
    '[class~="mod-warning"] { color: red; }',
  ])('rejects Obsidian class selectors from pivi-react CSS: %s', (source) => {
    const fixtureRoot = mkdtempSync(join(tmpdir(), 'pivi-boundary-'));
    try {
      mkdirSync(join(fixtureRoot, 'packages/pivi-react/styles'), { recursive: true });
      writeFileSync(join(fixtureRoot, 'packages/pivi-react/styles/fixture.css'), source);

      const result = runArchitectureCheck(fixtureRoot);

      expect(result.status).toBe(1);
      expect(result.stderr).toContain(
        '[@pivi/pivi-react CSS selectors use product-owned classes]',
      );
    } finally {
      rmSync(fixtureRoot, { force: true, recursive: true });
    }
  });

  it('allows product-owned modal names, unrelated file names, dialog roles, and app adapters', () => {
    const fixtureRoot = mkdtempSync(join(tmpdir(), 'pivi-boundary-'));
    try {
      mkdirSync(join(fixtureRoot, 'packages/pivi-react/src/image-modal'), { recursive: true });
      mkdirSync(join(fixtureRoot, 'packages/pivi-react/styles'), { recursive: true });
      mkdirSync(join(fixtureRoot, 'src/app/ui'), { recursive: true });
      writeFileSync(
        join(fixtureRoot, 'packages/pivi-react/src/image-modal/fixture.tsx'),
        '<div className="pivi-modal pivi-modal-layer" role="dialog" />;',
      );
      writeFileSync(
        join(fixtureRoot, 'packages/pivi-react/styles/fixture.css'),
        '.pivi-modal, .image-modal { display: block; }',
      );
      writeFileSync(
        join(fixtureRoot, 'src/app/ui/fixture.ts'),
        "element.classList.add('modal', 'theme-dark');",
      );

      const result = runArchitectureCheck(fixtureRoot);

      expect(result.status).toBe(0);
    } finally {
      rmSync(fixtureRoot, { force: true, recursive: true });
    }
  });

  it.each([
    'export interface ObsidianSettingsPort { save(): void; }',
    'export interface SettingsPort { vaultPath: string; }',
    'export interface SettingsPort { keychainAvailable: boolean; }',
    'export type SecretStorageStatus = "ready" | "missing";',
    'export type { VaultStatus } from "./host-types";',
  ])('rejects host-specific public identifiers from pivi-react ports: %s', (source) => {
    const fixtureRoot = mkdtempSync(join(tmpdir(), 'pivi-boundary-'));
    try {
      mkdirSync(join(fixtureRoot, 'packages/pivi-react/src/ports'), { recursive: true });
      writeFileSync(join(fixtureRoot, 'packages/pivi-react/src/ports/fixture.ts'), source);

      const result = runArchitectureCheck(fixtureRoot);

      expect(result.status).toBe(1);
      expect(result.stderr).toContain(
        '[@pivi/pivi-react public ports use host-neutral identifiers]',
      );
    } finally {
      rmSync(fixtureRoot, { force: true, recursive: true });
    }
  });

  it('allows workspace terminology in ports and host implementation names outside the port seam', () => {
    const fixtureRoot = mkdtempSync(join(tmpdir(), 'pivi-boundary-'));
    try {
      mkdirSync(join(fixtureRoot, 'packages/pivi-react/src/ports'), { recursive: true });
      mkdirSync(join(fixtureRoot, 'src/app/ui'), { recursive: true });
      writeFileSync(
        join(fixtureRoot, 'packages/pivi-react/src/ports/fixture.ts'),
        'export interface SettingsPort { workspaceName: string; secureStorageAvailable: boolean; }',
      );
      writeFileSync(
        join(fixtureRoot, 'src/app/ui/obsidianAdapter.ts'),
        'export const vaultKeychainAdapter = true;',
      );

      const result = runArchitectureCheck(fixtureRoot);

      expect(result.status).toBe(0);
    } finally {
      rmSync(fixtureRoot, { force: true, recursive: true });
    }
  });

  it('rejects host-specific pivi-react locale key names', () => {
    const fixtureRoot = mkdtempSync(join(tmpdir(), 'pivi-boundary-'));
    try {
      const locale = createPortableLocaleFixture();
      Object.assign(locale.settings, {
        secret_storage_notice: 'Host-specific catalog copy remains allowed.',
      });
      mkdirSync(join(fixtureRoot, 'packages/pivi-react/src/i18n/locales'), { recursive: true });
      writeFileSync(
        join(fixtureRoot, 'packages/pivi-react/src/i18n/locales/en.json'),
        JSON.stringify(locale),
      );

      const result = runArchitectureCheck(fixtureRoot);

      expect(result.status).toBe(1);
      expect(result.stderr).toContain(
        '[@pivi/pivi-react locale keys use host-neutral terminology]',
      );
    } finally {
      rmSync(fixtureRoot, { force: true, recursive: true });
    }
  });

  it.each([
    ['missing placeholder', 'Stored in the credential service.'],
    ['hard-coded legacy term', 'Stored in the keychain {secureStorageName}.'],
    ['hard-coded API term', 'Stored in SecretStorage {secureStorageName}.'],
    ['hard-coded workspace term', 'Commands for the vault {workspaceName}.'],
  ])('rejects non-parameterized pivi-react locale copy: %s', (_label, replacement) => {
    const fixtureRoot = mkdtempSync(join(tmpdir(), 'pivi-boundary-'));
    try {
      const locale = createPortableLocaleFixture();
      if (_label === 'hard-coded workspace term') {
        locale.settings.slashCommands.desc = replacement;
      } else {
        locale.settings.modelsTab.intro = replacement;
      }
      mkdirSync(join(fixtureRoot, 'packages/pivi-react/src/i18n/locales'), { recursive: true });
      writeFileSync(
        join(fixtureRoot, 'packages/pivi-react/src/i18n/locales/en.json'),
        JSON.stringify(locale),
      );

      const result = runArchitectureCheck(fixtureRoot);

      expect(result.status).toBe(1);
      expect(result.stderr).toContain(
        '[@pivi/pivi-react locale copy parameterizes host terminology]',
      );
    } finally {
      rmSync(fixtureRoot, { force: true, recursive: true });
    }
  });

  it('allows parameterized locale copy and host descriptor values', () => {
    const fixtureRoot = mkdtempSync(join(tmpdir(), 'pivi-boundary-'));
    try {
      const locale = createPortableLocaleFixture();
      Object.assign(locale.settings, {
        noteToolbar: { desc: 'Configure this Obsidian integration in the app adapter.' },
      });
      mkdirSync(join(fixtureRoot, 'packages/pivi-react/src/i18n/locales'), { recursive: true });
      writeFileSync(
        join(fixtureRoot, 'packages/pivi-react/src/i18n/locales/en.json'),
        JSON.stringify(locale),
      );

      const result = runArchitectureCheck(fixtureRoot);

      expect(result.status).toBe(0);
    } finally {
      rmSync(fixtureRoot, { force: true, recursive: true });
    }
  });

  it('rejects workspace package imports that bypass declared exports', () => {
    const fixtureRoot = mkdtempSync(join(tmpdir(), 'pivi-boundary-'));
    try {
      mkdirSync(join(fixtureRoot, 'packages/presentation/src'), { recursive: true });
      mkdirSync(join(fixtureRoot, 'src/app'), { recursive: true });
      writeFileSync(
        join(fixtureRoot, 'packages/presentation/package.json'),
        JSON.stringify({
          exports: { '.': './src/index.ts', './store': './src/store.ts' },
          name: '@pivi/presentation',
        }),
      );
      writeFileSync(
        join(fixtureRoot, 'src/app/fixture.ts'),
        "import { internal } from '@pivi/presentation/internal';",
      );

      const result = runArchitectureCheck(fixtureRoot);

      expect(result.status).toBe(1);
      expect(result.stderr).toContain('[@pivi imports use declared package exports]');
    } finally {
      rmSync(fixtureRoot, { recursive: true, force: true });
    }
  });

  it('rejects nested imports not included in an explicit engine export list', () => {
    const fixtureRoot = mkdtempSync(join(tmpdir(), 'pivi-boundary-'));
    try {
      mkdirSync(join(fixtureRoot, 'packages/core/src'), { recursive: true });
      mkdirSync(join(fixtureRoot, 'src/app'), { recursive: true });
      writeFileSync(
        join(fixtureRoot, 'packages/core/package.json'),
        JSON.stringify({
          exports: {
            '.': './src/index.ts',
            './engine': './src/engine/index.ts',
            './engine/pi': './src/engine/pi/index.ts',
            './engine/pi/public': './src/engine/pi/public.ts',
          },
          name: '@pivi/core',
        }),
      );
      writeFileSync(
        join(fixtureRoot, 'src/app/fixture.ts'),
        "import { internal } from '@pivi/core/engine/pi/internal';",
      );

      const result = runArchitectureCheck(fixtureRoot);

      expect(result.status).toBe(1);
      expect(result.stderr).toContain('[@pivi imports use declared package exports]');
      expect(result.stderr).toContain('@pivi/core/engine/pi/internal');
    } finally {
      rmSync(fixtureRoot, { recursive: true, force: true });
    }
  });

  it('does not resolve internal Pi collaborators through package exports', () => {
    const result = spawnSync(process.execPath, [
      '--input-type=module',
      '--eval',
      `try {
        import.meta.resolve('@pivi/pivi-agent-core/engine/pi/piChatRuntimeUsage');
        process.exitCode = 2;
      } catch (error) {
        if (error.code !== 'ERR_PACKAGE_PATH_NOT_EXPORTED') throw error;
      }`,
    ], {
      cwd: rootDir,
      encoding: 'utf8',
    });

    expect(result.status).toBe(0);
  });

  it('rejects circular value imports while allowing type-only dependency edges', () => {
    const fixtureRoot = mkdtempSync(join(tmpdir(), 'pivi-boundary-'));
    try {
      mkdirSync(join(fixtureRoot, 'src/app'), { recursive: true });
      writeFileSync(
        join(fixtureRoot, 'src/app/a.ts'),
        "import { b } from './b'; export const a = b;",
      );
      writeFileSync(
        join(fixtureRoot, 'src/app/b.ts'),
        "import { a } from './a'; export const b = a;",
      );

      const result = runArchitectureCheck(fixtureRoot);

      expect(result.status).toBe(1);
      expect(result.stderr).toContain('[source modules have no circular value imports]');
    } finally {
      rmSync(fixtureRoot, { recursive: true, force: true });
    }
  });
});
