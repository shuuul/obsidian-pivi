import type { PiviSettings } from '../../types/settings';

function normalizeHiddenCommandName(value: string): string {
  return value.trim().replace(/^[/$]+/, '');
}

export function normalizeHiddenCommandList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const seen = new Set<string>();
  const normalized: string[] = [];

  for (const item of value) {
    if (typeof item !== 'string') {
      continue;
    }

    const commandName = normalizeHiddenCommandName(item);
    if (!commandName) {
      continue;
    }

    const key = commandName.toLowerCase();
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    normalized.push(commandName);
  }

  return normalized;
}

export function getHiddenSlashCommands(
  settings: Pick<PiviSettings, 'hiddenSlashCommands'>,
): string[] {
  return settings.hiddenSlashCommands ?? [];
}

export function getHiddenSlashCommandSet(
  settings: Pick<PiviSettings, 'hiddenSlashCommands'>,
): Set<string> {
  return new Set(getHiddenSlashCommands(settings).map((command) => command.toLowerCase()));
}
