import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('settings navigation styles', () => {
  const styles = readFileSync(
    join(process.cwd(), 'packages/pivi-react/styles/settings/base.css'),
    'utf8',
  );

  it('keeps primary tabs on one native horizontally scrollable row', () => {
    expect(styles).toMatch(/\.pivi-settings-tabs\s*{[^}]*overflow-x:\s*auto;/s);
    expect(styles).toMatch(/\.pivi-settings-tab\s*{[^}]*flex:\s*0 0 auto;[^}]*white-space:\s*nowrap;/s);
    expect(styles).toMatch(/\.pivi-settings-tab\s*{[^}]*appearance:\s*none;/s);
  });

  it('keeps Tools sections in a vertical document flow', () => {
    expect(styles).toMatch(/\.pivi-tools-settings-page\s*{[^}]*flex-direction:\s*column;/s);
    expect(styles).not.toContain('.pivi-tools-settings-section + .pivi-tools-settings-section');
  });

  it('uses quiet section labels on the shared gutter with asymmetric spacing', () => {
    expect(styles).toMatch(/\.pivi-settings\s*{[^}]*--pivi-settings-section-gap:/s);
    expect(styles).toMatch(/\.pivi-settings-section-heading\s*{[^}]*margin:\s*0;[^}]*padding-inline:\s*var\(--pivi-settings-gutter\);/s);
    expect(styles).toMatch(/\.pivi-settings-section-heading\s*{[^}]*font-size:\s*var\(--pivi-host-font-ui-small\);/s);
    expect(styles).toMatch(/\.pivi-settings-section-heading\s*{[^}]*color:\s*var\(--pivi-host-text-muted\);/s);
    expect(styles).toMatch(/\.pivi-settings-section\s*{[^}]*margin-block-start:\s*var\(--pivi-settings-section-gap\);/s);
    expect(styles).toMatch(/\.pivi-settings-section > \.pivi-settings-section-heading\s*{[^}]*margin-block-end:\s*var\(--pivi-settings-section-title-gap\);/s);
    expect(styles).not.toContain('.pivi-settings-list-header__title');
    expect(styles).not.toContain('.pivi-tools-settings-section__title');
  });

  it('groups sections with whitespace and keeps integration item titles quiet', () => {
    expect(styles).not.toMatch(/\.pivi-settings-section-heading\s*{[^}]*border-top:/s);
    expect(styles).toMatch(/\.pivi-integration-setting \.pivi-setting-row__name\s*{[^}]*font-size:\s*var\(--pivi-host-font-ui-small\);[^}]*font-weight:\s*var\(--pivi-host-font-medium\);/s);
    expect(styles.match(/\.pivi-integration-setting \.pivi-setting-row__name\s*{/g)).toHaveLength(1);
    expect(styles).toMatch(/\.pivi-settings-list-header\s*{[^}]*padding-inline:\s*var\(--pivi-settings-gutter\);/s);
  });
});
