export const SUBAGENT_PROFILES = [
  { name: 'Austen', runningIcon: 'rocking-chair' },
  { name: 'Baldwin', runningIcon: 'flame' },
  { name: 'Borges', runningIcon: 'compass' },
  { name: 'Brontë', runningIcon: 'wind' },
  { name: 'Calvino', runningIcon: 'telescope' },
  { name: 'Dostoevsky', runningIcon: 'key' },
  { name: 'Eliot', runningIcon: 'cat' },
  { name: 'Homer', runningIcon: 'anchor' },
  { name: 'Kafka', runningIcon: 'stamp' },
  { name: 'Le Guin', runningIcon: 'satellite-dish' },
  { name: 'Morrison', runningIcon: 'feather' },
  { name: 'Murakami', runningIcon: 'tornado' },
  { name: 'Neruda', runningIcon: 'heart-pulse' },
  { name: 'Sappho', runningIcon: 'music' },
  { name: 'Tolstoy', runningIcon: 'swords' },
  { name: 'Woolf', runningIcon: 'waves' },
] as const;

export const SUBAGENT_WRITER_NAMES: readonly string[] = Object.freeze(
  SUBAGENT_PROFILES.map(profile => profile.name),
);

type SubagentProfile = (typeof SUBAGENT_PROFILES)[number];

const SUBAGENT_PROFILE_BY_NAME: ReadonlyMap<string, SubagentProfile> = new Map(
  SUBAGENT_PROFILES.map(profile => [profile.name, profile] as const),
);

export function stableSubagentHash(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i++) {
    hash = (hash * 31 + value.charCodeAt(i)) >>> 0;
  }
  return hash;
}

export function resolveSubagentWriterName(id: string): string {
  return SUBAGENT_WRITER_NAMES[stableSubagentHash(id) % SUBAGENT_WRITER_NAMES.length];
}

export function getSubagentWriterBaseName(writerName: string): string {
  return writerName.replace(/\s+\d+$/, '');
}

export function resolveSubagentWriterIconName(writerName?: string): string | undefined {
  if (!writerName) return undefined;
  return SUBAGENT_PROFILE_BY_NAME.get(getSubagentWriterBaseName(writerName))?.runningIcon;
}
