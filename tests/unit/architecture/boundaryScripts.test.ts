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
        "import { mountChatView } from '@pivi/obsidian-react/mount';",
      );

      const result = runArchitectureCheck(fixtureRoot);

      expect(result.status).toBe(1);
      expect(result.stderr).toContain(
        '[only src/app/ui mounts @pivi/obsidian-react surfaces]',
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
      mkdirSync(join(fixtureRoot, 'packages/obsidian-react/src'), { recursive: true });
      writeFileSync(
        join(fixtureRoot, 'packages/obsidian-react/src/fixture.ts'),
        source,
      );

      const result = runArchitectureCheck(fixtureRoot);

      expect(result.status).toBe(1);
      expect(result.stderr).toContain(
        '[@pivi/obsidian-react stays presentation-only and product-neutral]',
      );
      expect(result.stderr).toContain('packages/obsidian-react/src/fixture.ts:1');
    } finally {
      rmSync(fixtureRoot, { recursive: true, force: true });
    }
  });

  it('allows non-chat runtime contracts needed by React presentation adapters', () => {
    const fixtureRoot = mkdtempSync(join(tmpdir(), 'pivi-boundary-'));
    try {
      mkdirSync(join(fixtureRoot, 'packages/obsidian-react/src'), { recursive: true });
      writeFileSync(
        join(fixtureRoot, 'packages/obsidian-react/src/fixture.ts'),
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
    "import { ChatUiStore } from '@pivi/obsidian-react';",
    "import type { ChatUiSnapshot } from '@pivi/obsidian-react';",
    "import { parseMessageMentions } from '@pivi/obsidian-react/mentions';",
    "import { recalculateUsageForModel } from '@pivi/obsidian-react/usage';",
    "import { mountChatView } from '@pivi/obsidian-react/mount';",
    "import type { ChatPresentationPort } from '@pivi/obsidian-react/ports';",
    "void import('@pivi/obsidian-react');",
    "require('@pivi/obsidian-react/internal');",
  ])('rejects non-presentation React package edges from src/ui: %s', (source) => {
    const fixtureRoot = mkdtempSync(join(tmpdir(), 'pivi-boundary-'));
    try {
      mkdirSync(join(fixtureRoot, 'src/ui'), { recursive: true });
      writeFileSync(join(fixtureRoot, 'src/ui/fixture.ts'), source);

      const result = runArchitectureCheck(fixtureRoot);

      expect(result.status).toBe(1);
      expect(result.stderr).toContain(
        '[src/ui uses only approved @pivi/obsidian-react presentation subpaths]',
      );
    } finally {
      rmSync(fixtureRoot, { recursive: true, force: true });
    }
  });

  it.each([
    '@pivi/obsidian-react/store',
    '@pivi/obsidian-react/inline-edit',
    '@pivi/obsidian-react/context-badges',
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
      mkdirSync(join(fixtureRoot, 'packages/obsidian-react/src'), { recursive: true });
      writeFileSync(
        join(fixtureRoot, 'src/ui/fixture.ts'),
        "import '../../packages/obsidian-react/src/index';",
      );

      const result = runArchitectureCheck(fixtureRoot);

      expect(result.status).toBe(1);
      expect(result.stderr).toContain(
        '[src/ui uses only approved @pivi/obsidian-react presentation subpaths]',
      );
    } finally {
      rmSync(fixtureRoot, { recursive: true, force: true });
    }
  });
});
