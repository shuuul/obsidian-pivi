import { SELECTED_TEXT_TEMPLATE_TOKEN } from '@pivi/agent/context/mentions';
import { PluginLogger } from '@pivi/agent/logging/pluginLogger';
import type { AuxQueryRunner } from '@pivi/agent/runtime/auxQueryRunner';
import { isValidModelKey } from '@pivi/agent/settings/modelKey';
import {
  requiresSelectedText,
  resolveWorkspaceCommandPrompt,
} from '@pivi/agent/skills/commands/resolveWorkspaceCommandPrompt';
import type { SlashCatalogEntry } from '@pivi/agent/skills/commands/slashCommandEntry';
import { capToolResultText } from '@pivi/agent/tools';
import type { CliData, Plugin } from 'obsidian';

import { t } from '@/app/i18n';

const logger = new PluginLogger('PiviCli');

/** One-shot system prompt for headless workspace command runs. */
const CLI_RUN_SYSTEM_PROMPT = [
  'You execute one Pivi workspace command and return the result to the caller.',
  'The user message is the resolved command prompt. Complete the requested task',
  'and answer with the result only, as concise Markdown.',
  'Do not ask follow-up questions; if the request cannot be completed, state why briefly.',
].join(' ');

export interface PiviCliNote {
  readonly basename: string;
  readonly content: string;
}

export interface PiviCliHost {
  /**
   * Resolve and read a note by link-style name or exact vault path.
   * Returns null when the note cannot be resolved.
   */
  readNote(
    file: string | undefined,
    path: string | undefined,
  ): Promise<PiviCliNote | null>;
  listWorkspaceEntries(): Promise<readonly SlashCatalogEntry[]>;
  createAuxQueryRunner(): AuxQueryRunner;
  getDefaultModel(): string;
  today(): string;
}

function param(value: string | undefined): string {
  // Bare boolean flags arrive as the literal 'true'; treat them as unset values.
  return typeof value === 'string' && value !== 'true' ? value : '';
}

function normalizeCommandName(value: string): string {
  return value.trim().replace(/^\//, '');
}

function findWorkspaceCommand(
  entries: readonly SlashCatalogEntry[],
  name: string,
): SlashCatalogEntry | null {
  const lowered = name.toLowerCase();
  return entries.find(entry => entry.name === name)
    ?? entries.find(entry => entry.name.toLowerCase() === lowered)
    ?? null;
}

export async function runPiviCliCommand(
  host: PiviCliHost,
  params: CliData,
): Promise<string> {
  const commandName = normalizeCommandName(param(params.command));
  if (!commandName) {
    throw new Error(t('commands.cli.errorNoCommand'));
  }

  const entries = await host.listWorkspaceEntries();
  const entry = findWorkspaceCommand(entries, commandName);
  if (!entry) {
    const names = entries.map(candidate => candidate.name).slice(0, 20).join(', ');
    throw new Error(t('commands.cli.errorUnknownCommand', { name: commandName, names }));
  }

  const modelParam = param(params.model).trim();
  const modelKey = modelParam || host.getDefaultModel().trim();
  if (modelKey && !isValidModelKey(modelKey)) {
    throw new Error(t('commands.cli.errorInvalidModel'));
  }

  const fileParam = param(params.file).trim();
  const pathParam = param(params.path).trim();
  let currentNote = '';
  let currentNoteName = '';
  if (fileParam || pathParam) {
    const note = await host.readNote(fileParam || undefined, pathParam || undefined);
    if (!note) {
      throw new Error(t('commands.cli.errorNoteNotFound'));
    }
    currentNote = note.content;
    currentNoteName = note.basename;
  }

  const selection = param(params.selection);
  if (requiresSelectedText(entry.content) && !selection.trim()) {
    throw new Error(t('commands.cli.errorSelectionRequired'));
  }

  const prompt = resolveWorkspaceCommandPrompt(entry.content, {
    selectedText: selection,
    currentNote,
    currentNoteName,
    date: host.today(),
  }).trim();
  if (!prompt) {
    throw new Error(t('commands.cli.errorEmptyPrompt'));
  }

  const runner = host.createAuxQueryRunner();
  try {
    const result = await runner.query(
      { systemPrompt: CLI_RUN_SYSTEM_PROMPT, model: modelKey || undefined },
      prompt,
    );
    return capToolResultText(result, { label: 'pivi:run result' });
  } finally {
    runner.reset();
  }
}

export function registerPiviCli(plugin: Plugin, host: PiviCliHost): void {
  plugin.registerCliHandler('pivi:run', t('commands.cli.runDescription'), {
    command: {
      value: '<name>',
      description: t('commands.cli.flagCommand'),
      required: true,
    },
    file: {
      value: '<name>',
      description: t('commands.cli.flagFile'),
    },
    path: {
      value: '<path>',
      description: t('commands.cli.flagPath'),
    },
    model: {
      value: '<provider/model>',
      description: t('commands.cli.flagModel'),
    },
    selection: {
      value: '<text>',
      description: t('commands.cli.flagSelection', {
        selectedTextToken: SELECTED_TEXT_TEMPLATE_TOKEN,
      }),
    },
  }, params => {
    return runPiviCliCommand(host, params).catch((error: unknown) => {
      logger.error('pivi:run failed', error);
      throw error;
    });
  });
}
