import type { MentionBadgeParseContext } from '@pivi/pivi-agent-core/context/mentions';
import { getObsidianToolsSettingsFromBag } from '@pivi/pivi-agent-core/foundation/settings';
import type {
  SettingsMentionEditorCallbacks,
  SettingsMentionEditorHandle,
  SettingsMentionEditorPort,
} from '@pivi/pivi-react/ports';
import type { App } from 'obsidian';

import type { PiviPluginWorkspace,PiviSettingsHost } from '@/app/hostContracts';
import { getVaultPath, normalizePathForVault } from '@/app/hostPlatform';
import { SlashCommandDropdown } from '@/ui/shared/components/SlashCommandDropdown';
import type {
  DropdownMcpServerProvider,
  DropdownMcpToolProvider,
} from '@/ui/shared/components/slashCommandDropdownData';
import { getActiveWindow } from '@/ui/shared/dom';
import { createMentionVaultLookup } from '@/ui/shared/mention/createMentionVaultLookup';
import { MentionDropdownController } from '@/ui/shared/mention/MentionDropdownController';
import { MentionInput } from '@/ui/shared/mention/MentionInput';
import { getVaultFileAliases as getVaultFileAliasesFromMetadata } from '@/ui/shared/mention/obsidianMentionVault';
import { VaultMentionDataProvider } from '@/ui/shared/mention/VaultMentionDataProvider';
import { buildExternalContextDisplayEntries } from '@/ui/shared/utils/externalContext';

function buildMentionContext(
  app: App,
  workspace: PiviPluginWorkspace,
  host: PiviSettingsHost,
): MentionBadgeParseContext {
  return {
    vault: createMentionVaultLookup(app),
    mcpServerNames: new Set(
      workspace.mcpServerManager.getServers().map((server) => server.name),
    ),
    skillCommandNames: new Set(
      workspace.skillProvider.listSkills().map((skill) => skill.name),
    ),
    externalContextEntries: buildExternalContextDisplayEntries(
      getObsidianToolsSettingsFromBag(host.settings).externalReadDirectories,
    ),
  };
}

function getActiveVaultFilePath(app: App): string | null {
  const activePath = app.workspace.getActiveFile?.()?.path ?? null;
  return normalizePathForVault(activePath, getVaultPath(app));
}

function getExternalContexts(host: PiviSettingsHost): string[] {
  return getObsidianToolsSettingsFromBag(host.settings).externalReadDirectories;
}

export function createMentionEditorPort(
  host: PiviSettingsHost,
  workspace: PiviPluginWorkspace,
): SettingsMentionEditorPort {
  const app = host.app;

  return {
    mount(
      container: HTMLElement,
      initialValue: string,
      callbacks: SettingsMentionEditorCallbacks,
    ): SettingsMentionEditorHandle {
      const mentionInput = new MentionInput(container, {
        app,
        className: 'pivi-settings-mention-editor',
        getMentionContext: () => buildMentionContext(app, workspace, host),
      });
      mentionInput.el.setAttribute('dir', 'auto');
      mentionInput.value = initialValue;

      const vaultDataProvider = new VaultMentionDataProvider(app);
      vaultDataProvider.initializeInBackground();

      const mcpServerProvider: DropdownMcpServerProvider = {
        getServers: () => workspace.mcpServerManager.getServers(),
      };
      const mcpMentionProvider = {
        getServers: () => workspace.mcpServerManager.getServers(),
        getContextSavingServers: () =>
          workspace.mcpServerManager.getContextSavingServers(),
      };
      const mcpToolProvider: DropdownMcpToolProvider = {
        listTools: (serverName) => workspace.mcpToolProvider.listTools(serverName),
      };

      const mentionDropdown = new MentionDropdownController(
        container,
        mentionInput,
        {
          onAttachFile: () => undefined,
          getMentionedMcpServers: () => new Set(),
          setMentionedMcpServers: () => false,
          addMentionedMcpServer: () => undefined,
          getExternalContexts: () => getExternalContexts(host),
          getCachedVaultFolders: () => vaultDataProvider.getCachedVaultFolders(),
          getCachedVaultFiles: () => vaultDataProvider.getCachedVaultFiles(),
          getVaultFileAliases: (file) => getVaultFileAliasesFromMetadata(app, file),
          getActiveVaultFilePath: () => getActiveVaultFilePath(app),
          normalizePathForVault: (rawPath) =>
            normalizePathForVault(rawPath, getVaultPath(app)),
        },
      );
      mentionDropdown.setMcpManager(mcpMentionProvider);
      mentionDropdown.setAgentService(null);

      const slashConfig = workspace.slashCommandCatalog.getDropdownConfig();
      const slashDropdown = new SlashCommandDropdown(
        container,
        mentionInput,
        { onSelect: () => undefined },
        {
          hiddenCommands: new Set(),
          catalogConfig: slashConfig,
          getCatalogEntries: () =>
            workspace.slashCommandCatalog.listDropdownEntries({
              includeBuiltIns: true,
            }),
          getMcpManager: () => mcpServerProvider,
          getMcpToolProvider: () => mcpToolProvider,
          getSkills: () => workspace.skillProvider.listSkills(),
        },
      );

      const inputHandler = (): void => {
        mentionDropdown.handleInputChange();
        callbacks.onChange?.(mentionInput.value);
      };
      mentionInput.addEventListener('input', inputHandler);

      const keydownHandler = (e: KeyboardEvent): void => {
        if (mentionInput.el.ownerDocument.activeElement !== mentionInput.el) return;
        if (slashDropdown.handleKeydown(e)) return;
        if (mentionDropdown.handleKeydown(e)) return;
      };
      const ownerWindow = getActiveWindow(mentionInput.el);
      const keydownOptions = { capture: true } as const;
      ownerWindow.addEventListener(
        'keydown',
        keydownHandler as EventListener,
        keydownOptions,
      );

      const pasteHandler = (e: ClipboardEvent): void => {
        mentionInput.handlePaste(e);
        callbacks.onChange?.(mentionInput.value);
      };
      mentionInput.el.addEventListener('paste', pasteHandler);

      return {
        getValue: () => mentionInput.value,
        setValue: (text: string) => {
          mentionInput.value = text;
          callbacks.onChange?.(text);
        },
        focus: () => mentionInput.focus(),
        setDisabled: (disabled: boolean) => {
          mentionInput.el.setAttribute(
            'contenteditable',
            disabled ? 'false' : 'true',
          );
        },
        destroy: () => {
          ownerWindow.removeEventListener(
            'keydown',
            keydownHandler as EventListener,
            keydownOptions,
          );
          mentionInput.removeEventListener('input', inputHandler);
          mentionInput.el.removeEventListener('paste', pasteHandler);
          mentionDropdown.destroy();
          slashDropdown.destroy();
          mentionInput.destroy();
        },
      };
    },
  };
}
