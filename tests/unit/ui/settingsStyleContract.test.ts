import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

const stylesRoot = join(process.cwd(), 'packages/pivi-react/styles');
const settingsRoot = join(process.cwd(), 'packages/pivi-react/src/settings');
const tokensFile = join(stylesRoot, 'settings/system/tokens.css');
const allowlistPath = join(process.cwd(), 'tests/unit/ui/settingsStyleContract.allowlist.json');
const manifestPath = join(stylesRoot, 'manifest.mjs');

const BANNED_LAYOUT = /^(margin|padding)(-|$)|^(row-|column-)?gap$|^border-radius$|^border$|^border-(top|right|bottom|left|block|inline)(-start|-end)?$|^border.*-color$|^box-shadow$/;
const TOKEN_VALUE = /^var\(--pivi-(settings|host)-[a-z0-9-]+\)$/;
const TOKEN_DECLARATION = /--pivi-settings-[a-z0-9-]+\s*:/;
const SETTINGS_TOKEN_USE = /var\(--pivi-settings-([a-z0-9-]+)\)/g;
const SETTINGS_TOKEN_DECLARE = /--pivi-settings-([a-z0-9-]+)\s*:/g;
const STRUCTURAL_PREFIXES = [
  'pivi-settings-page',
  'pivi-settings-section',
  'pivi-settings-row',
  'pivi-settings-collection',
  'pivi-settings-card',
  'pivi-settings-actions',
  'pivi-settings-feedback',
  'pivi-sp-',
  'pivi-provider-card',
  'pivi-mcp-card',
  'pivi-web-provider-',
] as const;
const DELETED_STYLE_FILES = [
  'settings/base.css',
  'settings/provider-settings.css',
  'settings/command-editor.css',
  'settings/slash-settings.css',
  'settings/mcp-settings.css',
  'settings/prompt-settings.css',
  'settings/agent-settings.css',
] as const;
const DELETED_SELECTORS = [
  '.pivi-sp-',
  '.pivi-provider-card',
  '.pivi-mcp-card',
  '.pivi-web-provider-',
  '.pivi-tools-settings-page',
  '.pivi-settings-tabs',
  '.pivi-settings-tab',
] as const;
const DELETED_COMPONENTS = [
  'SettingsShell',
  'SettingsTabId',
  'SettingsListHeader',
  'SettingsPageDescription',
  'SettingsSectionHeading',
] as const;
const STRUCTURAL_TAG_ALLOWLIST: ReadonlyArray<{
  readonly file: string;
  readonly tag: string;
  readonly reason: string;
}> = [
  {
    file: 'PromptTab.tsx',
    tag: 'ul',
    reason: 'Prompt usage estimate list is feature-internal structure on the usage bar',
  },
  {
    file: 'mcp/McpServerEditor.tsx',
    tag: 'h2',
    reason: 'Add-server modal title; modal chrome is not a settings page heading',
  },
];

const legacyAllowlist = [] as const;

function listFiles(dir: string, suffix: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return listFiles(path, suffix);
    return entry.isFile() && entry.name.endsWith(suffix) ? [path] : [];
  });
}

function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

interface CssDeclaration {
  readonly selector: string;
  readonly property: string;
  readonly value: string;
}

function parseDeclarations(css: string): CssDeclaration[] {
  const declarations: CssDeclaration[] = [];
  const walk = (source: string): void => {
    const atRule = /@(?:media|supports|layer)[^{]*\{/g;
    let match: RegExpExecArray | null;
    while ((match = atRule.exec(source)) !== null) {
      const start = match.index + match[0].length;
      let depth = 1;
      let index = start;
      while (index < source.length && depth > 0) {
        if (source[index] === '{') depth += 1;
        else if (source[index] === '}') depth -= 1;
        index += 1;
      }
      walk(source.slice(start, index - 1));
    }
    const withoutAt = source.replace(/@(?:media|supports|layer)[^{]*\{[\s\S]*?\n\}/g, '');
    const rule = /([^{}]+)\{([^{}]+)\}/g;
    let ruleMatch: RegExpExecArray | null;
    while ((ruleMatch = rule.exec(withoutAt)) !== null) {
      const selector = ruleMatch[1]?.trim() ?? '';
      const body = ruleMatch[2] ?? '';
      if (selector.startsWith('@')) continue;
      for (const line of body.split(';')) {
        const colon = line.indexOf(':');
        if (colon < 0) continue;
        const property = line.slice(0, colon).trim();
        const value = line.slice(colon + 1).trim();
        if (property) declarations.push({ selector, property, value });
      }
    }
  };
  walk(stripComments(css));
  return declarations;
}

function extractClassNames(source: string): string[] {
  const names: string[] = [];
  const patterns = [
    /className\s*=\s*"([^"]+)"/g,
    /className\s*=\s*'([^']+)'/g,
    /className\s*=\s*\{`([^`]*)`\}/g,
    /className\s*=\s*\{'([^']*)'\}/g,
    /className\s*=\s*\{"([^"]*)"\}/g,
  ];
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) {
      for (const part of (match[1] ?? '').split(/\$\{[^}]*\}/)) {
        for (const token of part.split(/\s+/)) {
          if (token) names.push(token);
        }
      }
    }
  }
  return names;
}

function collectManifestModules(): string[] {
  const source = readFileSync(manifestPath, 'utf8');
  return [...source.matchAll(/'([^']+\.css)'/g)].map(match => match[1] ?? '');
}

function concatenatedStyles(): string {
  return collectManifestModules()
    .map(modulePath => readFileSync(join(stylesRoot, modulePath), 'utf8'))
    .join('\n');
}

describe('settings style contract', () => {
  const hostTheme = readFileSync(
    join(process.cwd(), 'packages/obsidian-host/styles/pivi-theme.css'),
    'utf8',
  );
  const hostCss = readFileSync(join(stylesRoot, 'settings/system/host.css'), 'utf8');
  const layoutCss = readFileSync(join(stylesRoot, 'settings/system/layout.css'), 'utf8');
  const rowCss = readFileSync(join(stylesRoot, 'settings/system/row.css'), 'utf8');
  const controlsCss = readFileSync(join(stylesRoot, 'settings/system/controls.css'), 'utf8');
  const cardCss = readFileSync(join(stylesRoot, 'settings/system/card.css'), 'utf8');
  const tokensCss = readFileSync(tokensFile, 'utf8');
  const allowlist = JSON.parse(readFileSync(allowlistPath, 'utf8')) as string[];
  const stylesSource = concatenatedStyles();
  const manifestSource = readFileSync(manifestPath, 'utf8');

  it('rejects banned feature-CSS declarations except reviewed allowlist triples', () => {
    const featuresDir = join(stylesRoot, 'settings/features');
    const violations: string[] = [];
    for (const file of listFiles(featuresDir, '.css')) {
      const relativeFile = relative(join(stylesRoot, 'settings/features'), file).split('\\').join('/');
      for (const declaration of parseDeclarations(readFileSync(file, 'utf8'))) {
        const triple = `${relativeFile}:${declaration.selector}:${declaration.property}`;
        if (allowlist.includes(triple)) continue;
        if (BANNED_LAYOUT.test(declaration.property)) {
          violations.push(`${triple} uses banned layout/border/shadow`);
          continue;
        }
        if (declaration.property === 'color' || declaration.property.startsWith('background')) {
          if (!TOKEN_VALUE.test(declaration.value)) {
            violations.push(`${triple} must be a settings or host token`);
          }
        }
      }
    }
    expect(allowlist).toEqual([]);
    expect(violations).toEqual([]);
  });

  it('declares --pivi-settings-* custom properties only in system/tokens.css', () => {
    const offenders: string[] = [];
    for (const file of listFiles(stylesRoot, '.css')) {
      if (file === tokensFile) continue;
      if (TOKEN_DECLARATION.test(readFileSync(file, 'utf8'))) {
        offenders.push(relative(stylesRoot, file).split('\\').join('/'));
      }
    }
    expect(offenders).toEqual([]);
    expect(tokensCss).toMatch(TOKEN_DECLARATION);
  });

  it('uses only --pivi-settings-* tokens declared in system/tokens.css', () => {
    const declared = new Set<string>();
    for (const match of tokensCss.matchAll(SETTINGS_TOKEN_DECLARE)) {
      declared.add(match[1] ?? '');
    }
    const missing: string[] = [];
    for (const file of listFiles(stylesRoot, '.css')) {
      const relativeFile = relative(stylesRoot, file).split('\\').join('/');
      for (const match of readFileSync(file, 'utf8').matchAll(SETTINGS_TOKEN_USE)) {
        const name = match[1] ?? '';
        if (!declared.has(name)) missing.push(`${relativeFile}:--pivi-settings-${name}`);
      }
    }
    expect([...declared].sort()).not.toEqual([]);
    expect(missing).toEqual([]);
  });

  it('bans raw structural class names outside settings/primitives except the empty legacy allowlist', () => {
    const offenders: string[] = [];
    for (const file of listFiles(settingsRoot, '.tsx')) {
      const relativeFile = relative(settingsRoot, file).split('\\').join('/');
      if (relativeFile.startsWith('primitives/')) continue;
      for (const className of extractClassNames(readFileSync(file, 'utf8'))) {
        const banned = STRUCTURAL_PREFIXES.find(prefix => className.startsWith(prefix));
        if (!banned) continue;
        if (legacyAllowlist.some(prefix => className.startsWith(prefix))) continue;
        offenders.push(`${relativeFile}:${className}`);
      }
    }
    expect(legacyAllowlist).toEqual([]);
    expect(offenders).toEqual([]);
  });

  it('does not import the deleted controls adapter', () => {
    const offenders: string[] = [];
    for (const file of [...listFiles(settingsRoot, '.tsx'), ...listFiles(settingsRoot, '.ts')]) {
      const relativeFile = relative(settingsRoot, file).split('\\').join('/');
      if (relativeFile.startsWith('primitives/')) continue;
      const source = readFileSync(file, 'utf8');
      if (/from ['"]\.\.\/controls['"]|from ['"]\.\/controls['"]|settings\/controls/.test(source)) {
        offenders.push(relativeFile);
      }
    }
    expect(existsSync(join(settingsRoot, 'controls.tsx'))).toBe(false);
    expect(offenders).toEqual([]);
  });

  it('keeps raw structural headings and lists inside primitives or an explicit allow entry', () => {
    const offenders: string[] = [];
    for (const file of listFiles(settingsRoot, '.tsx')) {
      const relativeFile = relative(settingsRoot, file).split('\\').join('/');
      if (relativeFile.startsWith('primitives/')) continue;
      const source = readFileSync(file, 'utf8');
      for (const match of source.matchAll(/<(h2|h3|ul|table)[\s>]/g)) {
        const tag = match[1] ?? '';
        const allowed = STRUCTURAL_TAG_ALLOWLIST.some(entry => entry.file === relativeFile && entry.tag === tag);
        if (!allowed) offenders.push(`${relativeFile}:${tag}`);
      }
    }
    expect(offenders).toEqual([]);
    expect(STRUCTURAL_TAG_ALLOWLIST.every(entry => entry.reason.length > 0)).toBe(true);
  });

  it('removes deleted legacy settings CSS files and selectors', () => {
    const presentFiles = DELETED_STYLE_FILES.filter(file => existsSync(join(stylesRoot, file)));
    expect(presentFiles).toEqual([]);
    for (const file of DELETED_STYLE_FILES) {
      expect(manifestSource).not.toContain(`'${file}'`);
    }
    const selectorHits = DELETED_SELECTORS.filter(selector => stylesSource.includes(selector));
    expect(selectorHits).toEqual([]);
  });

  it('does not keep deleted settings components', () => {
    const hits: string[] = [];
    for (const file of [...listFiles(settingsRoot, '.tsx'), ...listFiles(settingsRoot, '.ts')]) {
      const relativeFile = relative(settingsRoot, file).split('\\').join('/');
      const source = readFileSync(file, 'utf8');
      for (const name of DELETED_COMPONENTS) {
        if (source.includes(name)) hits.push(`${relativeFile}:${name}`);
      }
    }
    expect(hits).toEqual([]);
  });

  it('lets the Obsidian settings page own scrolling around the definition row', () => {
    expect(hostCss).toMatch(/:root \.pivi-settings-definition-host\.pivi-settings-definition-host\s*{[^}]*display:\s*block;[^}]*height:\s*auto;[^}]*max-height:\s*none;[^}]*padding:\s*0;[^}]*overflow:\s*visible;[^}]*border-top:\s*0;/s);
  });

  it('uses native heading metrics and a surfaced section body', () => {
    expect(layoutCss).toMatch(/\.pivi-settings-section\s*{[^}]*margin-block-start:\s*var\(--pivi-settings-section-gap\);/s);
    expect(layoutCss).toMatch(/\.pivi-settings-section-heading\s*{[^}]*font-family:\s*var\(--pivi-host-font-interface\);/s);
    expect(layoutCss).toMatch(/\.pivi-settings-section-heading\s*{[^}]*font-size:\s*var\(--pivi-settings-heading-size\);/s);
    expect(layoutCss).toMatch(/\.pivi-settings-section-heading\s*{[^}]*color:\s*var\(--pivi-host-text-normal\);/s);
    expect(layoutCss).toMatch(/\.pivi-settings-section__header\s*{[^}]*border-block-end:\s*1px solid\s+var\(--pivi-settings-hairline\);/s);
    expect(layoutCss).toMatch(/\.pivi-settings-section__body\s*{[^}]*background:\s*var\(--pivi-settings-surface-background\);/s);
    expect(layoutCss).toMatch(/\.pivi-settings-section--nested \.pivi-settings-section__body\s*{[^}]*background:\s*transparent;[^}]*border-radius:\s*0;/s);
    expect(layoutCss).toMatch(/\.pivi-settings-section--nested \.pivi-settings-section-heading\s*{[^}]*font-size:\s*var\(--pivi-settings-heading-size-nested\);/s);
    expect(hostCss).toMatch(/\.pivi-settings(?:-page)?(?:,\s*\.pivi-settings-page)?\s*{[^}]*min-height:\s*100%;[^}]*background:\s*var\(--pivi-host-background-primary\);/s);
    expect(hostCss).toMatch(/\.pivi-settings-host-surface-reset\s*{[^}]*background:\s*transparent;[^}]*padding:\s*0;[^}]*border-radius:\s*0;/s);
    expect(layoutCss).not.toContain('.pivi-settings-list-header__title');
  });

  it('maps the grouped-item host token for surfaced section bodies', () => {
    expect(hostTheme).not.toContain('--pivi-host-settings-background');
    expect(hostTheme).toMatch(/--pivi-host-setting-items-background:\s*var\(--setting-items-background, var\(--background-primary-alt\)\);/);
    expect(tokensCss).not.toMatch(/--pivi-host-setting-items-background\s*:/);
    expect(hostCss).not.toMatch(/--pivi-host-setting-items-background\s*:/);
  });

  it('keeps integration item titles quiet', () => {
    expect(rowCss).toMatch(/\.pivi-integration-setting \.pivi-settings-row__name\s*{[^}]*font-size:\s*var\(--pivi-host-font-ui-small\);[^}]*font-weight:\s*var\(--pivi-host-font-medium\);/s);
    expect(rowCss.match(/\.pivi-integration-setting \.pivi-settings-row__name\s*{/g)).toHaveLength(1);
  });

  it('wraps installed-skill row status onto a full-width line below the actions', () => {
    expect(rowCss).toMatch(/\.pivi-settings-row__actions > \.pivi-settings-feedback\s*{[^}]*flex:\s*1 0 100%;/s);
  });

  it('lets an open disclosure card grow instead of clipping nested disclosures', () => {
    expect(cardCss).toMatch(/\.pivi-settings-actions\s*{[^}]*background:\s*transparent;/s);
    expect(cardCss).toMatch(/\.pivi-settings-actions\s*{[^}]*border-radius:\s*0;/s);
    expect(cardCss).toMatch(/\.pivi-settings-card\.is-open\s*{[^}]*overflow:\s*visible;/s);
  });

  it('keeps disclosure footers flush with the last field instead of stacking extra body space', () => {
    expect(cardCss).toMatch(/\.pivi-settings-card__body > form,\s*\.pivi-settings-card__body > \.pivi-mcp-inline-editor \{\s*margin:\s*0;/s);
    expect(cardCss).toMatch(/\.pivi-settings-card__footer\s*\{[^}]*padding-block-start:\s*var\(--pivi-settings-row-padding-block\);/s);
  });

  it('puts expanded configuration on a nested surface distinct from the list', () => {
    expect(tokensCss).toMatch(/--pivi-settings-inset-surface-background:\s*var\(--pivi-host-background-secondary\);/);
    expect(tokensCss).toMatch(/--pivi-settings-nested-surface-background:\s*var\(--pivi-host-background-primary\);/);
    expect(cardCss).toMatch(/\.pivi-settings-card__body\s*{[^}]*background:\s*var\(--pivi-settings-inset-surface-background\);/s);
    expect(controlsCss).toMatch(/\.pivi-editor-toolbar-picker\s*{[^}]*background:\s*var\(--pivi-settings-inset-surface-background\);/s);
    expect(controlsCss).toMatch(/\.pivi-editor-toolbar-picker__list\s*{[^}]*background:\s*var\(--pivi-settings-nested-surface-background\);/s);
  });

  it('gives custom-provider name and base URL fields the remaining row width', () => {
    expect(rowCss).toMatch(/\.pivi-provider-endpoint-fields > \.pivi-settings-row > \.pivi-settings-row__control\s*{[^}]*flex:\s*1 1 0;/s);
    expect(rowCss).toMatch(/\.pivi-provider-endpoint-fields > \.pivi-settings-row > \.pivi-settings-row__control > \.pivi-settings-control:not\(\.pivi-select\)\s*{[^}]*width:\s*100%;/s);
  });

  it('applies the 280px control basis only on inline rows', () => {
    expect(rowCss).toMatch(/\.pivi-settings-row:not\(\.pivi-settings-row--stacked\) > \.pivi-settings-row__control > \.pivi-settings-control:not\(\.pivi-select\)\s*{[^}]*flex:\s*0 1 var\(--pivi-settings-control-width\);/s);
    expect(rowCss).toMatch(/\.pivi-settings-row--stacked > \.pivi-settings-row__control\s*{[^}]*flex-direction:\s*row;[^}]*flex-wrap:\s*wrap;[^}]*align-items:\s*center;/s);
    expect(rowCss).toMatch(/\.pivi-settings-row--stacked > \.pivi-settings-row__control > :is\(\s*input:not\(\[type='checkbox'\]\),\s*\.pivi-settings-control:not\(\.pivi-select\):not\(textarea\),\s*\.pivi-settings-badge-field\s*\)\s*{[^}]*flex:\s*1 1 auto;[^}]*min-width:\s*0;/s);
    expect(rowCss).toMatch(/\.pivi-settings-row--stacked > \.pivi-settings-row__control > textarea\s*{[^}]*flex:\s*1 1 100%;/s);
    expect(rowCss).toMatch(/\.pivi-settings-row--stacked > \.pivi-settings-row__control > :is\(button, \.pivi-settings-action-group\)\s*{[^}]*flex:\s*0 0 auto;/s);
    expect(rowCss).toMatch(/\.pivi-settings-row--stacked > \.pivi-settings-row__control > textarea ~ :is\(button, \.pivi-settings-action-group\)\s*{[^}]*margin-inline-start:\s*auto;/s);
  });

  it('neutralizes host button chrome only for icon and add-text triggers', () => {
    expect(controlsCss).toMatch(/\.pivi-settings button\.pivi-settings-action-btn,/);
    expect(controlsCss).toMatch(/\.pivi-settings button\.pivi-settings-text-btn \{/);
    expect(controlsCss).not.toMatch(/\.pivi-settings-action-group > button:not/);
    expect(controlsCss).not.toMatch(/\.pivi-settings-row__control > button:not/);
  });
});
