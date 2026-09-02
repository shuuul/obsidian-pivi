import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('settings navigation styles', () => {
  const styles = readFileSync(
    join(process.cwd(), 'packages/pivi-react/styles/settings/base.css'),
    'utf8',
  );
  const hostTheme = readFileSync(
    join(process.cwd(), 'packages/obsidian-host/styles/pivi-theme.css'),
    'utf8',
  );

  it('lets the Obsidian settings page own scrolling around the definition row', () => {
    expect(styles).toMatch(/:root \.pivi-settings-definition-host\.pivi-settings-definition-host\s*{[^}]*display:\s*block;[^}]*height:\s*auto;[^}]*max-height:\s*none;[^}]*padding:\s*0;[^}]*overflow:\s*visible;[^}]*border-top:\s*0;/s);
  });

  it('keeps primary tabs wrapping so every tab stays visible', () => {
    expect(styles).toMatch(/\.pivi-settings-tabs\s*{[^}]*flex-wrap:\s*wrap;/s);
    expect(styles).toMatch(/\.pivi-settings-tab\s*{[^}]*flex:\s*0 0 auto;[^}]*white-space:\s*nowrap;/s);
    expect(styles).toMatch(/\.pivi-settings-tab\s*{[^}]*appearance:\s*none;/s);
  });

  it('keeps Tools sections in a vertical document flow', () => {
    expect(styles).toMatch(/\.pivi-tools-settings-page\s*{[^}]*flex-direction:\s*column;/s);
    expect(styles).not.toContain('.pivi-tools-settings-section + .pivi-tools-settings-section');
  });

  it('uses quiet section labels with subtle dividers and grouped surfaces', () => {
    expect(styles).toMatch(/\.pivi-settings\s*{[^}]*--pivi-settings-section-gap:/s);
    expect(styles).toMatch(/\.pivi-settings\s*{[^}]*min-height:\s*100%;[^}]*background:\s*var\(--pivi-host-background-primary\);/s);
    expect(styles).toMatch(/\.pivi-settings-section-heading\s*{[^}]*margin:\s*0;[^}]*padding-inline:\s*var\(--pivi-settings-gutter\);/s);
    expect(styles).toMatch(/\.pivi-settings-section-heading\s*{[^}]*font-size:\s*var\(--pivi-host-font-ui-small\);/s);
    expect(styles).toMatch(/\.pivi-settings-section-heading\s*{[^}]*color:\s*var\(--pivi-host-text-muted\);/s);
    expect(styles).toMatch(/\.pivi-settings-section\s*{[^}]*margin-block-start:\s*var\(--pivi-settings-section-gap\);/s);
    expect(styles).toMatch(/\.pivi-settings-section > \.pivi-settings-section-heading\s*{[^}]*margin-block-end:\s*var\(--pivi-settings-section-title-gap\);/s);
    expect(styles).toMatch(/\.pivi-settings-section > \.pivi-settings-section-heading:not\(\.pivi-settings-section-heading--sub\)\s*{[^}]*border-block-end:\s*1px solid/s);
    expect(styles).toMatch(/\.pivi-settings-section > \.pivi-settings-section-heading:not\(\.pivi-settings-section-heading--sub\) \+ \.pivi-settings-section__body\s*{[^}]*border-radius:\s*var\(--pivi-radius-lg\);[^}]*background:\s*var\(--pivi-host-setting-items-background\);/s);
    expect(styles).not.toContain('.pivi-settings-list-header__title');
    expect(styles).not.toContain('.pivi-tools-settings-section__title');
  });

  it('uses the primary page surface and maps the grouped-item surface', () => {
    expect(hostTheme).not.toContain('--pivi-host-settings-background');
    expect(hostTheme).toMatch(/--pivi-host-setting-items-background:\s*var\(--setting-items-background, var\(--background-primary-alt\)\);/);
  });

  it('gives collection headers a divider and keeps integration item titles quiet', () => {
    expect(styles).not.toMatch(/\.pivi-settings-section-heading\s*{[^}]*border-top:/s);
    expect(styles).toMatch(/\.pivi-integration-setting \.pivi-setting-row__name\s*{[^}]*font-size:\s*var\(--pivi-host-font-ui-small\);[^}]*font-weight:\s*var\(--pivi-host-font-medium\);/s);
    expect(styles.match(/\.pivi-integration-setting \.pivi-setting-row__name\s*{/g)).toHaveLength(1);
    expect(styles).toMatch(/\.pivi-settings-list-header\s*{[^}]*padding-inline:\s*var\(--pivi-settings-gutter\);[^}]*border-block-end:\s*1px solid/s);
  });

  it('wraps installed-skill row status onto a full-width line below the actions', () => {
    expect(styles).toMatch(/\.pivi-sp-item\s*{[^}]*flex-wrap:\s*wrap;/s);
    expect(styles).toMatch(/\.pivi-sp-item > \.pivi-settings-action-feedback\s*{[^}]*flex:\s*1 0 100%;/s);
  });
});

describe('settings disclosure card overflow', () => {
  const providerStyles = readFileSync(
    join(process.cwd(), 'packages/pivi-react/styles/settings/provider-settings.css'),
    'utf8',
  );

  it('lets an open provider card grow instead of clipping nested disclosures', () => {
    expect(providerStyles).toMatch(/\.pivi-provider-card\[open\]\s*{[^}]*overflow:\s*visible;/s);
  });

  it('gives custom-provider name and base URL fields the remaining row width', () => {
    expect(providerStyles).toMatch(/\.pivi-provider-endpoint-fields > \.pivi-setting-row > \.pivi-setting-row__control\s*{[^}]*flex:\s*1 1 0;/s);
    expect(providerStyles).toMatch(/\.pivi-provider-endpoint-fields > \.pivi-setting-row > \.pivi-setting-row__control > \.pivi-settings-control:not\(\.pivi-select\)\s*{[^}]*width:\s*100%;/s);
  });
});
