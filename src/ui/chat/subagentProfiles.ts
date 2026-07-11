export interface SubagentProfile {
  name: string;
  fullName: string;
  runningIcon: string;
}

export const SUBAGENT_PROFILES = [
  {
    name: 'Austen',
    fullName: 'Jane Austen',
    runningIcon: 'rocking-chair',
  },
  {
    name: 'Baldwin',
    fullName: 'James Baldwin',
    runningIcon: 'flame',
  },
  {
    name: 'Borges',
    fullName: 'Jorge Luis Borges',
    runningIcon: 'compass',
  },
  {
    name: 'Brontë',
    fullName: 'Emily Brontë',
    runningIcon: 'wind',
  },
  {
    name: 'Calvino',
    fullName: 'Italo Calvino',
    runningIcon: 'tree',
  },
  {
    name: 'Dostoevsky',
    fullName: 'Fyodor Dostoevsky',
    runningIcon: 'key',
  },
  {
    name: 'Eliot',
    fullName: 'T.S. Eliot',
    runningIcon: 'cat',
  },
  {
    name: 'Homer',
    fullName: 'Homer',
    runningIcon: 'anchor',
  },
  {
    name: 'Kafka',
    fullName: 'Franz Kafka',
    runningIcon: 'stamp',
  },
  {
    name: 'Le Guin',
    fullName: 'Ursula K. Le Guin',
    runningIcon: 'satellite-dish',
  },
  {
    name: 'Morrison',
    fullName: 'Toni Morrison',
    runningIcon: 'feather',
  },
  {
    name: 'Murakami',
    fullName: 'Haruki Murakami',
    runningIcon: 'tornado',
  },
  {
    name: 'Neruda',
    fullName: 'Pablo Neruda',
    runningIcon: 'heart-pulse',
  },
  {
    name: 'Sappho',
    fullName: 'Sappho',
    runningIcon: 'music',
  },
  {
    name: 'Tolstoy',
    fullName: 'Leo Tolstoy',
    runningIcon: 'swords',
  },
  {
    name: 'Woolf',
    fullName: 'Virginia Woolf',
    runningIcon: 'waves',
  },
  {
    name: 'Rand',
    fullName: 'Ayn Rand',
    runningIcon: 'scale',
  },
  {
    name: 'Mishima',
    fullName: 'Mishima Yukio',
    runningIcon: 'flower-2',
  },
  {
    name: 'Pamuk',
    fullName: 'Ferit Orhan Pamuk',
    runningIcon: 'snowflake',
  },
] as const satisfies readonly SubagentProfile[];

export const SUBAGENT_WRITER_NAMES: readonly string[] = Object.freeze(
  SUBAGENT_PROFILES.map(profile => profile.name),
);

const SUBAGENT_PROFILE_BY_NAME: ReadonlyMap<string, SubagentProfile> = new Map(
  SUBAGENT_PROFILES.map(profile => [profile.name, profile] as const),
);

// Historical records without a persisted writer name used this original pool.
// Keep that fallback stable as new profiles are added.
const LEGACY_SUBAGENT_WRITER_NAMES = SUBAGENT_WRITER_NAMES.slice(0, 16);

export function stableSubagentHash(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i++) {
    hash = (hash * 31 + value.charCodeAt(i)) >>> 0;
  }
  return hash;
}

export function resolveSubagentWriterName(id: string): string {
  return LEGACY_SUBAGENT_WRITER_NAMES[stableSubagentHash(id) % LEGACY_SUBAGENT_WRITER_NAMES.length];
}

export function getSubagentWriterBaseName(writerName: string): string {
  return writerName.replace(/\s+\d+$/, '');
}

export function resolveSubagentWriterIconName(writerName?: string): string | undefined {
  if (!writerName) return undefined;
  return SUBAGENT_PROFILE_BY_NAME.get(getSubagentWriterBaseName(writerName))?.runningIcon;
}
