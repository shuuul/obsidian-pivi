import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('subagent shell styles', () => {
  const styles = readFileSync(
    join(process.cwd(), 'packages/pivi-react/styles/components/subagent.css'),
    'utf8',
  );

  it('uses a uniform shell border without an inline branch line', () => {
    expect(styles).not.toContain('border-inline-start');
    expect(styles).not.toContain('.pivi-subagent-progress');
    expect(styles).not.toContain('.pivi-subagent-indicator-dot');
  });

  it('keeps the header and icon geometry stable while toggling', () => {
    expect(styles).toMatch(/\.pivi-subagent-header\s*\{[^}]*min-height:\s*0;/s);
    expect(styles).toMatch(/\.pivi-subagent-header\s*\{[^}]*height:\s*auto;/s);
    expect(styles).toMatch(/\.pivi-subagent-header\s*\{[^}]*padding:\s*3px 8px 3px 4px;/s);
    expect(styles).not.toMatch(/\.pivi-subagent-activity-item:not\(\.expanded\) \.pivi-subagent-header/);
    expect(styles).toMatch(/\.pivi-subagent-icon\s*\{[^}]*width:\s*16px;/s);
    expect(styles).toMatch(/\.pivi-subagent-icon\s*\{[^}]*height:\s*16px;/s);
    expect(styles).toMatch(/\.pivi-subagent-icon\s*\{[^}]*flex:\s*0 0 16px;/s);
  });

  it('keeps the subagent name stable and gives the brief description the remaining width', () => {
    expect(styles).toMatch(/\.pivi-subagent-label\s*\{[^}]*flex:\s*0 0 auto;/s);
    expect(styles).toMatch(/\.pivi-subagent-label\s*\{[^}]*font-size:\s*var\(--pivi-text-base\);/s);
    expect(styles).toMatch(/\.pivi-subagent-label\s*\{[^}]*line-height:\s*1\.2;/s);
    expect(styles).toMatch(/\.pivi-subagent-step-summary\s*\{[^}]*flex:\s*1;/s);
    expect(styles).toMatch(/\.pivi-subagent-step-summary\s*\{[^}]*font-size:\s*var\(--pivi-text-base\);/s);
    expect(styles).toMatch(/\.pivi-subagent-step-summary\s*\{[^}]*line-height:\s*1\.2;/s);
    expect(styles).toMatch(/\.pivi-subagent-step-summary\s*\{[^}]*text-overflow:\s*ellipsis;/s);
    expect(styles).not.toMatch(/\.pivi-subagent-activity-item:not\(\.expanded\) \.pivi-subagent-label/);
  });

  it('uses the shared small shell radius while collapsed and expanded', () => {
    expect(styles).toMatch(/\.pivi-subagent-activity-item\s*\{[^}]*border-radius:\s*var\(--pivi-radius-sm\);/s);
    expect(styles).not.toMatch(/\.pivi-subagent-activity-item:not\(\.expanded\)\s*\{[^}]*border-radius:/s);
    expect(styles).not.toMatch(/\.pivi-subagent-activity-item\.expanded\s*\{[^}]*border-radius:/s);
  });

  it('caps the shell while its body owns the only scrollbar', () => {
    expect(styles).toMatch(/\.pivi-subagent-list\.expanded\s*\{[^}]*max-height:\s*var\(--pivi-expanded-content-max-height/s);
    expect(styles).toMatch(/\.pivi-subagent-list\.expanded\s*\{[^}]*display:\s*flex;/s);
    expect(styles).not.toMatch(/\.pivi-subagent-content\s*\{[^}]*max-height:/s);
    expect(styles).toMatch(/\.pivi-subagent-list\.expanded > \.pivi-subagent-content\s*\{[^}]*overflow-y:\s*auto;/s);
    expect(styles).not.toMatch(/\.pivi-subagent-content\s*\{[^}]*resize:/s);
    expect(styles).not.toContain('58vh');
  });

  it('publishes zero top padding on the subagent scroll body for a gapless sticky stack', () => {
    expect(styles).toMatch(/\.pivi-subagent-content\s*\{[^}]*padding-block:\s*0 8px;/s);
    expect(styles).not.toContain('--pivi-subagent-content-padding-top');
    expect(styles).toMatch(/\.pivi-subagent-content > :first-child\s*\{[^}]*margin-block-start:\s*6px;/s);
  });

  it('keeps the subagent header layout-fixed at the card top', () => {
    expect(styles).toMatch(/\.pivi-subagent-list\.expanded\s*\{[^}]*overflow:\s*hidden;/s);
    expect(styles).toMatch(/\.pivi-subagent-list\.expanded > \.pivi-subagent-header\s*\{[^}]*flex:\s*0 0 auto;/s);
    expect(styles).not.toMatch(/\.pivi-subagent-list\.expanded > \.pivi-subagent-header\s*\{[^}]*position:\s*sticky;/s);
    expect(styles).toMatch(/\.pivi-subagent-list\.expanded > \.pivi-subagent-header\s*\{[^}]*z-index:\s*9;/s);
  });
});
