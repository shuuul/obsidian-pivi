export interface SubagentProfile {
  name: string;
  fullName: string;
  runningIcon: string;
  quotes: readonly [string, string, string];
}

export const SUBAGENT_PROFILES = [
  {
    name: 'Austen',
    fullName: 'Jane Austen',
    runningIcon: 'rocking-chair',
    quotes: [
      'I could no more write a romance than an epic poem. I must keep to my own style and go on in my own way.',
      'The person, be it gentleman or lady, who has not pleasure in a good novel, must be intolerably stupid.',
      'A fondness for reading, which, properly directed, must be an education in itself.',
    ],
  },
  {
    name: 'Baldwin',
    fullName: 'James Baldwin',
    runningIcon: 'flame',
    quotes: [
      'You write in order to change the world, if you are able to change it, then at least to change the way people look at certain things.',
      'The purpose of art is to lay bare the questions which have been hidden by the answers.',
      'If you are going to be a writer there is nothing I can say to stop you; if you\'re not going to be a writer nothing I can say will help you.',
    ],
  },
  {
    name: 'Borges',
    fullName: 'Jorge Luis Borges',
    runningIcon: 'compass',
    quotes: [
      'I have always imagined that Paradise will be a kind of library.',
      'I cannot sleep unless I am surrounded by books.',
      'I am not sure that I exist, actually. I am all the writers that I have read, all the people that I have met, all the women that I have loved, all the cities I have visited.',
    ],
  },
  {
    name: 'Brontë',
    fullName: 'Emily Brontë',
    runningIcon: 'wind',
    quotes: [
      'He\'s more myself than I am. Whatever our souls are made of, his and mine are the same.',
      'I wish I were a girl again, half savage and hardy, and free... and laughing at injuries, not maddening under them.',
      'My love for Heathcliff resembles the eternal rocks beneath — a source of little visible delight, but necessary.',
    ],
  },
  {
    name: 'Calvino',
    fullName: 'Italo Calvino',
    runningIcon: 'tree',
    quotes: [
      'A classic is a book that has never finished saying what it has to say.',
      'When I\'m writing a book, I prefer not to speak about it, because only when the book is finished can I try to understand what I\'ve really done.',
      'The only kind of literature that is possible today: a literature that is both critical and creative.',
    ],
  },
  {
    name: 'Dostoevsky',
    fullName: 'Fyodor Dostoevsky',
    runningIcon: 'key',
    quotes: [
      'Pain and suffering are always inevitable for a large intelligence and a deep heart.',
      'What is hell? I maintain that it is the suffering of being unable to love.',
      'Man is sometimes extraordinarily, passionately, in love with suffering...',
    ],
  },
  {
    name: 'Eliot',
    fullName: 'T.S. Eliot',
    runningIcon: 'cat',
    quotes: [
      'April is the cruellest month, breeding lilacs out of the dead land, mixing memory and desire.',
      'We shall not cease from exploration, and the end of all our exploring will be to arrive where we started and know the place for the first time.',
      'For last year\'s words belong to last year\'s language. And next year\'s words await another voice.',
    ],
  },
  {
    name: 'Homer',
    fullName: 'Homer',
    runningIcon: 'anchor',
    quotes: [
      'Sing in me, Muse, and through me tell the story of that man skilled in all ways of contending.',
      'There is nothing more admirable than when two people who see eye to eye keep house as man and wife, confounding their enemies and delighting their friends.',
      'Even his griefs are a joy long after to one that remembers all that he wrought and endured.',
    ],
  },
  {
    name: 'Kafka',
    fullName: 'Franz Kafka',
    runningIcon: 'stamp',
    quotes: [
      'Writing is utter solitude, the descent into the cold abyss of oneself.',
      'I think we ought to read only the kind of books that wound and stab us.',
      'A book must be the axe for the frozen sea within us.',
    ],
  },
  {
    name: 'Le Guin',
    fullName: 'Ursula K. Le Guin',
    runningIcon: 'satellite-dish',
    quotes: [
      'My imagination makes me human and makes me a fool; it gives me all the world and exiles me from it.',
      'The unread story is not a story; it is little black marks on wood pulp. The reader, reading it, makes it alive.',
      'If you haven\'t learned how to do something, the people who have may seem to be magicians.',
    ],
  },
  {
    name: 'Morrison',
    fullName: 'Toni Morrison',
    runningIcon: 'feather',
    quotes: [
      'If there\'s a book that you want to read, but it hasn\'t been written yet, then you must write it.',
      'We die. That may be the meaning of life. But we do language. That may be the measure of our lives.',
      'Oppressive language does more than represent violence; it is violence; does more than represent the limits of knowledge; it limits knowledge.',
    ],
  },
  {
    name: 'Murakami',
    fullName: 'Haruki Murakami',
    runningIcon: 'tornado',
    quotes: [
      'There\'s no such thing as perfect writing, just like there\'s no such thing as perfect despair.',
      'When I write fiction I go to weird, secret places in myself. It\'s like exploring the cosmos, but inside yourself.',
      'If you concentrate on writing three or four hours a day and feel tired after a week, you\'re not going to be able to write a long work. What\'s needed is endurance.',
    ],
  },
  {
    name: 'Neruda',
    fullName: 'Pablo Neruda',
    runningIcon: 'heart-pulse',
    quotes: [
      'Love is so short, forgetting is so long.',
      'I love you as certain dark things are to be loved, in secret, between the shadow and the soul.',
      'Poetry is an act of peace. Peace goes into the making of a poet as flour goes into the making of bread.',
    ],
  },
  {
    name: 'Sappho',
    fullName: 'Sappho',
    runningIcon: 'music',
    quotes: [
      'Some say thronging cavalry, some say foot soldiers, others call a fleet the most beautiful of sights the dark earth offers, but I say it\'s whatever you love best.',
      'I could not hope to touch the sky with my two arms.',
      'You may forget but let me tell you this: someone in the future will remember us.',
    ],
  },
  {
    name: 'Tolstoy',
    fullName: 'Leo Tolstoy',
    runningIcon: 'swords',
    quotes: [
      'All happy families are alike; each unhappy family is unhappy in its own way.',
      'Everyone thinks of changing the world, but no one thinks of changing himself.',
      'Love is life. All, everything that I understand, I understand only because I love.',
    ],
  },
  {
    name: 'Woolf',
    fullName: 'Virginia Woolf',
    runningIcon: 'waves',
    quotes: [
      'A woman must have money and a room of her own if she is to write fiction.',
      'So long as you write what you wish to write, that is all that matters; and whether it matters for ages or only for hours, nobody can say.',
      'When I cannot see words curling like rings of smoke round me I am in darkness — I am nothing.',
    ],
  },
  {
    name: 'Rand',
    fullName: 'Ayn Rand',
    runningIcon: 'scale',
    quotes: [
      'A creative man is motivated by the desire to achieve, not by the desire to beat others.',
      'If you don\'t know, the thing to do is not to get scared, but to learn.',
      'The hardest thing to explain is the glaringly evident which everybody has decided not to see.',
    ],
  },
  {
    name: 'Mishima',
    fullName: 'Mishima Yukio',
    runningIcon: 'flower-2',
    quotes: [
      'In its essence, any art that relies on words makes use of their ability to eat away — of their corrosive function — just as etching depends on the corrosive power of nitric acid.',
      'I want to make a poem of my life.',
      'What transforms this world is — knowledge. Do you see what I mean? Nothing else can change anything in this world.',
    ],
  },
  {
    name: 'Pamuk',
    fullName: 'Ferit Orhan Pamuk',
    runningIcon: 'snowflake',
    quotes: [
      'I write because I want to read books like the ones I write.',
      'I write because I believe in literature, in the art of the novel, more than I believe in anything else.',
      'I write not to tell a story, but to compose a story.',
    ],
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
