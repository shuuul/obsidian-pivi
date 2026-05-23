import type { ObsiusSettings } from '../../types/settings';

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

export function getDefaultHiddenSlashCommands(): string[] {
  return [];
}

export function getHiddenSlashCommands(
  settings: Pick<ObsiusSettings, 'hiddenSlashCommands'>,
): string[] {
  return settings.hiddenSlashCommands ?? [];
}

export function getHiddenSlashCommandSet(
  settings: Pick<ObsiusSettings, 'hiddenSlashCommands'>,
): Set<string> {
  return new Set(getHiddenSlashCommands(settings).map((command) => command.toLowerCase()));
}

/** Migrates pre-flatten settings buckets into `hiddenSlashCommands`. */
export function migrateHiddenSlashCommandsFromStored(
  stored: Record<string, unknown>,
): string[] {
  const providerCommands = stored.hiddenProviderCommands;
  if (providerCommands && typeof providerCommands === 'object') {
    const piCommands = (providerCommands as Record<string, unknown>).pi;
    const normalized = normalizeHiddenCommandList(piCommands);
    if (normalized.length > 0) {
      return normalized;
    }
  }

  return normalizeHiddenCommandList(stored.hiddenSlashCommands);
}
