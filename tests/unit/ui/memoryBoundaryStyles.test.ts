import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('memory boundary styles', () => {
  const css = readFileSync(
    join(process.cwd(), 'packages/pivi-react/styles/components/messages.css'),
    'utf8',
  );

  it('keeps the checkpoint disclosure rounded without host press animation or shadow', () => {
    expect(css).toMatch(/\.pivi-memory-chip-button\s*\{[^}]*border-radius: var\(--pivi-radius-pill\);[^}]*box-shadow: none;[^}]*transform: none;[^}]*transition: none;/s);
    expect(css).toMatch(/\.pivi-memory-chip-button:hover,[\s\S]*?\.pivi-memory-chip-button:active\s*\{[^}]*border-radius: var\(--pivi-radius-pill\);[^}]*box-shadow: none;[^}]*transform: none;/s);
  });
});
