import {
  TOOL_OBSIDIAN_ATTACHMENT,
  TOOL_OBSIDIAN_BASE,
  TOOL_OBSIDIAN_BASH,
  TOOL_OBSIDIAN_DAILY,
  TOOL_OBSIDIAN_DELETE,
  TOOL_OBSIDIAN_EDIT,
  TOOL_OBSIDIAN_GENERATE_IMAGE,
  TOOL_OBSIDIAN_GRAPH,
  TOOL_OBSIDIAN_HISTORY,
  TOOL_OBSIDIAN_LINKS,
  TOOL_OBSIDIAN_LIST,
  TOOL_OBSIDIAN_LIST_EXTERNAL,
  TOOL_OBSIDIAN_MKDIR,
  TOOL_OBSIDIAN_MOVE,
  TOOL_OBSIDIAN_NOTE_INFO,
  TOOL_OBSIDIAN_OPEN,
  TOOL_OBSIDIAN_PROPERTIES,
  TOOL_OBSIDIAN_READ,
  TOOL_OBSIDIAN_READ_EXTERNAL,
  TOOL_OBSIDIAN_SEARCH,
  TOOL_OBSIDIAN_TAGS,
  TOOL_OBSIDIAN_TASKS,
  TOOL_OBSIDIAN_WRITE,
} from '@pivi/pivi-agent-core/tools';
import type {
  SettingsFeedbackMessage,
  SettingsHostIntegrationSection,
  SettingsToolRow,
} from '@pivi/pivi-react/ports';

import type { PiviSettingsHost } from '@/app/hostContracts';
import { isOfficialObsidianCliEnabled } from '@/app/hostPlatform';
import { t, type TranslationKey } from '@/app/i18n';
import type { NoteToolbarSetupResult } from '@/app/noteToolbarIntegration';

type ToolRequirement = 'cli' | 'external' | 'codex';

const TOOL_DESCRIPTORS: readonly [
  name: string,
  label: TranslationKey,
  description: TranslationKey,
  requirement?: ToolRequirement,
][] = [
  [TOOL_OBSIDIAN_READ, 'tools.display.read', 'tools.display.readDesc'],
  [TOOL_OBSIDIAN_EDIT, 'tools.display.edit', 'tools.display.editDesc'],
  [TOOL_OBSIDIAN_WRITE, 'tools.display.write', 'tools.display.writeDesc'],
  [TOOL_OBSIDIAN_SEARCH, 'tools.display.search', 'tools.display.searchDesc'],
  [TOOL_OBSIDIAN_NOTE_INFO, 'tools.display.noteInfo', 'tools.display.noteInfoDesc'],
  [TOOL_OBSIDIAN_LINKS, 'tools.display.links', 'tools.display.linksDesc'],
  [TOOL_OBSIDIAN_PROPERTIES, 'tools.display.properties', 'tools.display.propertiesDesc'],
  [TOOL_OBSIDIAN_TASKS, 'tools.display.tasks', 'tools.display.tasksDesc', 'cli'],
  [TOOL_OBSIDIAN_HISTORY, 'tools.display.history', 'tools.display.historyDesc', 'cli'],
  [TOOL_OBSIDIAN_DAILY, 'tools.display.daily', 'tools.display.dailyDesc', 'cli'],
  [TOOL_OBSIDIAN_GRAPH, 'tools.display.graph', 'tools.display.graphDesc'],
  [TOOL_OBSIDIAN_TAGS, 'tools.display.tags', 'tools.display.tagsDesc'],
  [TOOL_OBSIDIAN_BASE, 'tools.display.base', 'tools.display.baseDesc'],
  [TOOL_OBSIDIAN_DELETE, 'tools.display.delete', 'tools.display.deleteDesc'],
  [TOOL_OBSIDIAN_MOVE, 'tools.display.move', 'tools.display.moveDesc'],
  [TOOL_OBSIDIAN_LIST, 'tools.display.list', 'tools.display.listDesc'],
  [TOOL_OBSIDIAN_READ_EXTERNAL, 'tools.display.readExternal', 'tools.display.readExternalDesc', 'external'],
  [TOOL_OBSIDIAN_LIST_EXTERNAL, 'tools.display.listExternal', 'tools.display.listExternalDesc', 'external'],
  [TOOL_OBSIDIAN_MKDIR, 'tools.display.mkdir', 'tools.display.mkdirDesc'],
  [TOOL_OBSIDIAN_OPEN, 'tools.display.open', 'tools.display.openDesc'],
  [TOOL_OBSIDIAN_ATTACHMENT, 'tools.display.attachment', 'tools.display.attachmentDesc'],
  [TOOL_OBSIDIAN_GENERATE_IMAGE, 'tools.display.generateImage', 'tools.display.generateImageDesc', 'codex'],
  [TOOL_OBSIDIAN_BASH, 'tools.display.bash', 'tools.display.bashDesc'],
];

interface ObsidianToolSettingsView {
  readonly allowBash: boolean;
  readonly allowExternalRead: boolean;
  readonly disabledTools?: readonly string[];
}

export function createObsidianToolRows(
  settings: ObsidianToolSettingsView,
  hasCodexAuth: boolean,
): readonly SettingsToolRow[] {
  const officialCliEnabled = isOfficialObsidianCliEnabled();
  return TOOL_DESCRIPTORS.map(([name, labelKey, descriptionKey, requirement]) => {
    const available = requirement === 'cli'
      ? officialCliEnabled
      : requirement === 'external'
        ? settings.allowExternalRead
        : requirement === 'codex'
          ? hasCodexAuth
          : true;
    const unavailableKey = requirement === 'cli'
      ? 'settings.tools.unavailableOfficialCli'
      : requirement === 'external'
        ? 'settings.tools.unavailableExternalRead'
        : 'settings.tools.unavailableCodex';
    return {
      name,
      label: t(labelKey),
      description: available ? t(descriptionKey) : `${t(descriptionKey)} ${t(unavailableKey)}`,
      enabled: available && (name === TOOL_OBSIDIAN_BASH
        ? settings.allowBash
        : !(settings.disabledTools ?? []).includes(name)),
      available,
    };
  });
}

const STYLE_SETTINGS_ACTION = 'obsidian:open-style-settings';
const NOTE_TOOLBAR_LABEL_ACTION = 'obsidian:note-toolbar-label-and-icon';
const NOTE_TOOLBAR_ICON_ACTION = 'obsidian:note-toolbar-icon-only';

export function listObsidianIntegrationSections(
  noteToolbarInstalled: boolean,
): readonly SettingsHostIntegrationSection[] {
  const noteToolbarDisabledReason = noteToolbarInstalled
    ? undefined
    : t('settings.noteToolbar.installRequired');
  return [
    {
      id: 'obsidian:style-settings',
      heading: t('settings.styleSettings.name'),
      description: t('settings.styleSettings.desc'),
      actions: [{ id: STYLE_SETTINGS_ACTION, label: t('settings.styleSettings.open') }],
    },
    {
      id: 'obsidian:note-toolbar',
      heading: t('settings.noteToolbar.heading'),
      description: t('settings.noteToolbar.desc'),
      actions: [
        {
          id: NOTE_TOOLBAR_LABEL_ACTION,
          label: t('settings.noteToolbar.setupLabelAndIcon'),
          disabled: !noteToolbarInstalled,
          disabledReason: noteToolbarDisabledReason,
        },
        {
          id: NOTE_TOOLBAR_ICON_ACTION,
          label: t('settings.noteToolbar.setupIconOnly'),
          disabled: !noteToolbarInstalled,
          disabledReason: noteToolbarDisabledReason,
        },
      ],
    },
  ];
}

export function describeNoteToolbarResult(result: NoteToolbarSetupResult): SettingsFeedbackMessage {
  const kind = result.status === 'installed' || result.status === 'already-installed'
    ? 'success'
    : 'error';
  switch (result.status) {
    case 'installed': return { kind, message: t('settings.noteToolbar.installed') };
    case 'already-installed': return { kind, message: t('settings.noteToolbar.alreadyInstalled') };
    case 'style-settings-opened': return { kind, message: t('settings.noteToolbar.styleSettingsOpened') };
    case 'needs-text-toolbar': return { kind, message: t('settings.noteToolbar.needsToolbar') };
    case 'not-installed': return { kind, message: t('settings.noteToolbar.installRequired') };
    case 'plugin-activation-opened': return { kind, message: t('settings.noteToolbar.activationOpened') };
    case 'manual-setup-opened': return { kind, message: t('settings.noteToolbar.manualSetupOpened') };
    case 'unsupported-note-toolbar-version': return { kind, message: t('settings.noteToolbar.unsupportedVersion', {
      version: result.version ?? t('settings.noteToolbar.unknownError'),
    }) };
    case 'invalid-config': return { kind, message: t('settings.noteToolbar.invalidConfig') };
    case 'verification-failed': return { kind, message: t('settings.noteToolbar.verificationFailed') };
    case 'failed': return { kind, message: t('settings.noteToolbar.failed', {
      message: result.error ?? t('settings.noteToolbar.unknownError'),
    }) };
  }
}

export async function runObsidianIntegrationAction(
  host: PiviSettingsHost,
  actionId: string,
): Promise<{ readonly feedback?: SettingsFeedbackMessage }> {
  if (actionId === STYLE_SETTINGS_ACTION) {
    const opened = await host.openStyleSettings();
    return opened ? {} : {
      feedback: { kind: 'error', message: t('settings.styleSettings.installationOpened') },
    };
  }
  if (actionId === NOTE_TOOLBAR_LABEL_ACTION || actionId === NOTE_TOOLBAR_ICON_ACTION) {
    const result = await host.setupNoteToolbarIntegration(
      actionId === NOTE_TOOLBAR_LABEL_ACTION ? 'label-and-icon' : 'icon-only',
    );
    return { feedback: describeNoteToolbarResult(result) };
  }
  throw new Error(`Unknown Obsidian integration action: ${actionId}`);
}
