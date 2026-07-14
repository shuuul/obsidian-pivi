import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';

const stylesRoot = join(process.cwd(), 'packages/pivi-react/styles');
const manifestPath = join(stylesRoot, 'manifest.mjs');
const animationPath = join(stylesRoot, 'base/animations.css');
const mentionBadgePath = join(stylesRoot, 'components/mention-badges.css');
const accessibilityPath = join(stylesRoot, 'accessibility.css');
const mentionDropdownPath = join(stylesRoot, 'features/file-context.css');
const slashDropdownPath = join(stylesRoot, 'features/slash-commands.css');

function readProductStyles(directory: string): string {
  return readdirSync(directory, { withFileTypes: true })
    .flatMap((entry) => {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        return readProductStyles(path);
      }
      return entry.name.endsWith('.css') ? readFileSync(path, 'utf8') : [];
    })
    .join('\n');
}

describe('product animation styles', () => {
  it('prefixes every declared animation and keeps each declaration in use', () => {
    const animationStyles = readFileSync(animationPath, 'utf8');
    const allStyles = readProductStyles(stylesRoot);
    const animationNames = [...animationStyles.matchAll(/@keyframes\s+([\w-]+)/g)].map((match) => match[1]);

    expect(animationNames.length).toBeGreaterThan(0);
    for (const animationName of animationNames) {
      expect(animationName).toMatch(/^pivi-/);
      expect(allStyles.match(new RegExp(`\\b${animationName}\\b`, 'g'))?.length).toBeGreaterThan(1);
    }
  });

  it('uses smaller slash-token icons without changing the shared badge box', () => {
    const styles = readFileSync(mentionBadgePath, 'utf8');
    expect(styles).toContain('.pivi-context-badge-kind-skill .pivi-context-badge-icon svg');
    expect(styles).toContain('.pivi-context-badge-kind-mcp .pivi-context-badge-icon svg');
    expect(styles).toMatch(/\.pivi-context-badge--inline \{[\s\S]*?min-height: 18px;/);
    expect(styles).toMatch(/pivi-context-badge--inline\.pivi-context-badge-kind-skill[\s\S]*?width: 10px;/);
    expect(styles).toMatch(/\.pivi-context-badge--inline \{[\s\S]*?background: var\(--pivi-host-background-primary\);/);
    expect(styles).toMatch(/\.pivi-context-badge--inline \{[\s\S]*?border-color: var\(--pivi-host-border\);/);
  });

  it('uses interruptible discrete transitions for mention and slash dropups', () => {
    const animationStyles = readFileSync(animationPath, 'utf8');
    const mentionStyles = readFileSync(mentionDropdownPath, 'utf8');
    const slashStyles = readFileSync(slashDropdownPath, 'utf8');

    expect(animationStyles).not.toContain('pivi-panel-dropup-in');
    for (const styles of [mentionStyles, slashStyles]) {
      expect(styles).toContain('transition-behavior: allow-discrete');
      expect(styles).toContain('@starting-style');
      expect(styles).toMatch(/display var\(--pivi-duration-fast\) allow-discrete/);
    }
  });

  it('loads motion and transparency preferences after component styles', () => {
    const manifest = readFileSync(manifestPath, 'utf8');
    const accessibilityStyles = readFileSync(accessibilityPath, 'utf8');

    expect(manifest.trim()).toMatch(/'accessibility\.css',\s*\];$/);
    expect(accessibilityStyles).toMatch(/@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.pivi-send-button:active:not\(:disabled\)/);
    expect(accessibilityStyles).toMatch(/@media \(prefers-reduced-transparency: reduce\)[\s\S]*?\.pivi-mention-dropdown/);
    expect(accessibilityStyles).toMatch(/@media \(prefers-contrast: more\)[\s\S]*?\.pivi-status-panel/);
  });
});
