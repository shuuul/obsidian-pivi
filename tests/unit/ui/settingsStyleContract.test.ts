import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

const stylesRoot = join(process.cwd(), 'packages/pivi-react/styles');
const settingsRoot = join(process.cwd(), 'packages/pivi-react/src/settings');
const tokensFile = join(stylesRoot, 'settings/system/tokens.css');
const allowlistPath = join(process.cwd(), 'tests/unit/ui/settingsStyleContract.allowlist.json');

const BANNED_LAYOUT = /^(margin|padding)(-|$)|^(row-|column-)?gap$|^border-radius$|^border$|^border-(top|right|bottom|left|block|inline)(-start|-end)?$|^border.*-color$/;
const TOKEN_VALUE = /^var\(--pivi-(settings|host)-[a-z0-9-]+\)$/;
const TOKEN_DECLARATION = /--pivi-settings-[a-z0-9-]+\s*:/;
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

// WS-03–WS-06 shrink this to empty as pages migrate off legacy card/list classes.
const legacyAllowlist = [
  'pivi-sp-',
  'pivi-provider-card',
  'pivi-mcp-card',
  'pivi-web-provider-',
] as const;

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

describe('settings style contract', () => {
  const hostTheme = readFileSync(
    join(process.cwd(), 'packages/obsidian-host/styles/pivi-theme.css'),
    'utf8',
  );
  const hostCss = readFileSync(join(stylesRoot, 'settings/system/host.css'), 'utf8');
  const layoutCss = readFileSync(join(stylesRoot, 'settings/system/layout.css'), 'utf8');
  const rowCss = readFileSync(join(stylesRoot, 'settings/system/row.css'), 'utf8');
  const cardCss = readFileSync(join(stylesRoot, 'settings/system/card.css'), 'utf8');
  const baseCss = readFileSync(join(stylesRoot, 'settings/base.css'), 'utf8');
  const providerCss = readFileSync(join(stylesRoot, 'settings/provider-settings.css'), 'utf8');
  const allowlist = JSON.parse(readFileSync(allowlistPath, 'utf8')) as string[];

  it('rejects banned feature-CSS declarations except reviewed allowlist triples', () => {
    const featuresDir = join(stylesRoot, 'settings/features');
    const violations: string[] = [];
    for (const file of listFiles(featuresDir, '.css')) {
      const relativeFile = relative(join(stylesRoot, 'settings/features'), file).split('\\').join('/');
      for (const declaration of parseDeclarations(readFileSync(file, 'utf8'))) {
        const triple = `${relativeFile}:${declaration.selector}:${declaration.property}`;
        if (allowlist.includes(triple)) continue;
        if (BANNED_LAYOUT.test(declaration.property)) {
          violations.push(`${triple} uses banned layout/border`);
          continue;
        }
        if (declaration.property === 'color' || declaration.property.startsWith('background')) {
          if (!TOKEN_VALUE.test(declaration.value)) {
            violations.push(`${triple} must be a settings or host token`);
          }
        }
      }
    }
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
    expect(readFileSync(tokensFile, 'utf8')).toMatch(TOKEN_DECLARATION);
  });

  it('bans raw structural class names outside settings/primitives except the legacy allowlist', () => {
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
    expect(offenders).toEqual([]);
  });

  it('lets the Obsidian settings page own scrolling around the definition row', () => {
    expect(hostCss).toMatch(/:root \.pivi-settings-definition-host\.pivi-settings-definition-host\s*{[^}]*display:\s*block;[^}]*height:\s*auto;[^}]*max-height:\s*none;[^}]*padding:\s*0;[^}]*overflow:\s*visible;[^}]*border-top:\s*0;/s);
  });

  it('keeps primary tabs wrapping so every tab stays visible', () => {
    expect(baseCss).toMatch(/\.pivi-settings-tabs\s*{[^}]*flex-wrap:\s*wrap;/s);
    expect(baseCss).toMatch(/\.pivi-settings-tab\s*{[^}]*flex:\s*0 0 auto;[^}]*white-space:\s*nowrap;/s);
    expect(baseCss).toMatch(/\.pivi-settings-tab\s*{[^}]*appearance:\s*none;/s);
  });

  it('keeps Tools sections in a vertical document flow', () => {
    expect(baseCss).toMatch(/\.pivi-tools-settings-page\s*{[^}]*flex-direction:\s*column;/s);
    expect(baseCss).not.toContain('.pivi-tools-settings-section + .pivi-tools-settings-section');
  });

  it('uses quiet section labels with hairline dividers and no surfaced body', () => {
    expect(layoutCss).toMatch(/\.pivi-settings-section\s*{[^}]*margin-block-start:\s*var\(--pivi-settings-section-gap\);/s);
    expect(layoutCss).toMatch(/\.pivi-settings-section-heading\s*{[^}]*margin:\s*0;[^}]*font-size:\s*var\(--pivi-host-font-ui-small\);/s);
    expect(layoutCss).toMatch(/\.pivi-settings-section-heading\s*{[^}]*color:\s*var\(--pivi-host-text-muted\);/s);
    expect(layoutCss).toMatch(/\.pivi-settings-section__header\s*{[^}]*border-block-end:\s*1px solid\s+var\(--pivi-settings-hairline\);/s);
    expect(layoutCss).not.toContain('--pivi-host-setting-items-background');
    expect(hostCss).toMatch(/\.pivi-settings(?:-page)?(?:,\s*\.pivi-settings-page)?\s*{[^}]*min-height:\s*100%;[^}]*background:\s*var\(--pivi-host-background-primary\);/s);
    expect(layoutCss).not.toContain('.pivi-settings-list-header__title');
    expect(baseCss).not.toContain('.pivi-tools-settings-section__title');
  });

  it('maps the grouped-item host token without consuming it in settings', () => {
    expect(hostTheme).not.toContain('--pivi-host-settings-background');
    expect(hostTheme).toMatch(/--pivi-host-setting-items-background:\s*var\(--setting-items-background, var\(--background-primary-alt\)\);/);
    expect(baseCss).not.toContain('--pivi-host-setting-items-background');
    expect(layoutCss).not.toContain('--pivi-host-setting-items-background');
  });

  it('keeps integration item titles quiet', () => {
    expect(rowCss).toMatch(/\.pivi-integration-setting \.pivi-settings-row__name\s*{[^}]*font-size:\s*var\(--pivi-host-font-ui-small\);[^}]*font-weight:\s*var\(--pivi-host-font-medium\);/s);
    expect(rowCss.match(/\.pivi-integration-setting \.pivi-settings-row__name\s*{/g)).toHaveLength(1);
  });

  it('wraps installed-skill row status onto a full-width line below the actions', () => {
    expect(baseCss).toMatch(/\.pivi-sp-item\s*{[^}]*flex-wrap:\s*wrap;/s);
    expect(baseCss).toMatch(/\.pivi-sp-item > \.pivi-settings-feedback\s*{[^}]*flex:\s*1 0 100%;/s);
  });

  it('lets an open disclosure card grow instead of clipping nested disclosures', () => {
    expect(cardCss).toMatch(/\.pivi-settings-card\.is-open\s*{[^}]*overflow:\s*visible;/s);
    expect(providerCss).toMatch(/\.pivi-provider-card\[open\]\s*{[^}]*overflow:\s*visible;/s);
  });

  it('gives custom-provider name and base URL fields the remaining row width', () => {
    expect(providerCss).toMatch(/\.pivi-provider-endpoint-fields > \.pivi-settings-row > \.pivi-settings-row__control\s*{[^}]*flex:\s*1 1 0;/s);
    expect(providerCss).toMatch(/\.pivi-provider-endpoint-fields > \.pivi-settings-row > \.pivi-settings-row__control > \.pivi-settings-control:not\(\.pivi-select\)\s*{[^}]*width:\s*100%;/s);
  });
});
