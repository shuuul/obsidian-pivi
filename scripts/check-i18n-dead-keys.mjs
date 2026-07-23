import fs from 'node:fs';
import path from 'node:path';

import { listSourceFiles, rootDir } from './check-helpers.mjs';

const projectRoot = process.env.PIVI_I18N_PROJECT_ROOT
  ? path.resolve(process.env.PIVI_I18N_PROJECT_ROOT)
  : rootDir;
const localesDir = path.join(projectRoot, 'packages/pivi-react/src/i18n/locales');
const enPath = path.join(localesDir, 'en.json');

const DYNAMIC_PREFIX_RULES = [
  {
    prefix: 'settings.tabs.',
    values: [
      'general', 'models', 'skills', 'tools', 'subagents', 'webSearch', 'commands', 'mcp', 'integrations',
    ],
  },
];

const DYNAMIC_KEY_SOURCE_FILES = [
  {
    file: 'packages/pivi-react/src/settings/models/statusLabels.ts',
    patterns: [
      /'((?:settings\.modelsTab\.status(?:Desc)?)\.[^']+)'/g,
    ],
  },
  {
    file: 'src/app/ui/settingsHotkeys.ts',
    patterns: [
      /labelKey:\s*'([^']+)'/g,
    ],
  },
  {
    file: 'packages/pivi-agent-core/src/tools/toolPresentation.ts',
    patterns: [
      /(?:labelKey|stepPhraseKey):\s*'((?:tools\.(?:display|steps))\.[^']+)'/g,
      /key:\s*'((?:tools\.(?:display|steps))\.[^']+)'/g,
      /\bfile\([^\n]*,\s*'((?:tools\.steps)\.[^']+)'\)/g,
      /\bobsidian\([^\n]*,\s*'((?:tools\.display)\.[^']+)'\s*,/g,
    ],
  },
  {
    file: 'src/app/ui/obsidianSettingsIntegration.ts',
    patterns: [
      /'((?:tools\.display)\.[^']+)'/g,
    ],
  },
];

function collectCatalogKeys(value, prefix = '') {
  if (typeof value === 'string') {
    return [prefix.slice(0, -1)];
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return [];
  }
  return Object.entries(value).flatMap(([key, nested]) =>
    collectCatalogKeys(nested, `${prefix}${key}.`));
}

function addKey(set, key) {
  if (key) set.add(key);
}

const TRANSLATION_KEY_PATTERN =
  /(?:'|")((?:common|chat|settings|commands|tools|host|editor|highRisk)\.[A-Za-z0-9_.]+)(?:'|")/g;

function collectLiteralKeysFromSource(source) {
  const keys = new Set();
  for (const match of source.matchAll(TRANSLATION_KEY_PATTERN)) {
    addKey(keys, match[1]);
  }
  return keys;
}

function collectUsedKeys() {
  const used = new Set();

  for (const rule of DYNAMIC_PREFIX_RULES) {
    for (const value of rule.values) {
      addKey(used, `${rule.prefix}${value}`);
    }
  }

  for (const { file, patterns } of DYNAMIC_KEY_SOURCE_FILES) {
    const absolute = path.join(projectRoot, file);
    if (!fs.existsSync(absolute)) continue;
    const source = fs.readFileSync(absolute, 'utf8');
    for (const pattern of patterns) {
      for (const match of source.matchAll(pattern)) {
        addKey(used, match[1]);
      }
    }
  }

  const scanRoots = [
    path.join(projectRoot, 'src'),
    path.join(projectRoot, 'packages/pivi-react/src'),
  ];
  for (const scanRoot of scanRoots) {
    for (const file of listSourceFiles(scanRoot)) {
      if (!/\.(?:[cm]?tsx?)$/.test(file)) continue;
      const source = fs.readFileSync(file, 'utf8');
      for (const key of collectLiteralKeysFromSource(source)) {
        addKey(used, key);
      }
    }
  }

  return used;
}

function deleteKeyPath(value, dottedPath) {
  const parts = dottedPath.split('.');
  let current = value;
  for (let index = 0; index < parts.length - 1; index += 1) {
    const part = parts[index];
    if (!current || typeof current !== 'object' || Array.isArray(current)) {
      return false;
    }
    current = current[part];
  }
  const leaf = parts.at(-1);
  if (!current || typeof current !== 'object' || Array.isArray(current) || !(leaf in current)) {
    return false;
  }
  delete current[leaf];
  for (let index = parts.length - 2; index >= 0; index -= 1) {
    const part = parts[index];
    let parent = value;
    for (let parentIndex = 0; parentIndex < index; parentIndex += 1) {
      parent = parent[parts[parentIndex]];
    }
    const child = parent?.[part];
    if (
      child
      && typeof child === 'object'
      && !Array.isArray(child)
      && Object.keys(child).length === 0
    ) {
      delete parent[part];
      continue;
    }
    break;
  }
  return true;
}

const catalog = JSON.parse(fs.readFileSync(enPath, 'utf8'));
const catalogKeys = new Set(collectCatalogKeys(catalog));
const usedKeys = collectUsedKeys();
const deadKeys = [...catalogKeys].filter((key) => !usedKeys.has(key)).sort();

if (process.argv.includes('--write')) {
  if (deadKeys.length === 0) {
    console.log('No dead i18n keys to delete.');
    process.exit(0);
  }
  const localeFiles = fs.readdirSync(localesDir).filter((name) => name.endsWith('.json'));
  for (const localeFile of localeFiles) {
    const localePath = path.join(localesDir, localeFile);
    const locale = JSON.parse(fs.readFileSync(localePath, 'utf8'));
    for (const key of deadKeys) {
      deleteKeyPath(locale, key);
    }
    fs.writeFileSync(localePath, `${JSON.stringify(locale, null, 2)}\n`);
  }
  console.log(`Deleted ${deadKeys.length} dead i18n key(s) across ${localeFiles.length} locale files.`);
  process.exit(0);
}

if (deadKeys.length > 0) {
  console.error(`Found ${deadKeys.length} unused i18n key(s):`);
  for (const key of deadKeys) {
    console.error(`- ${key}`);
  }
  console.error('Run with --write to delete them from every locale catalog.');
  process.exit(1);
}

console.log(`i18n dead-key scan passed (${catalogKeys.size} catalog keys, ${usedKeys.size} referenced).`);
