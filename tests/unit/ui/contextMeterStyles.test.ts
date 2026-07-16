import fs from 'node:fs';
import path from 'node:path';

describe('context meter styles', () => {
  const css = fs.readFileSync(
    path.join(process.cwd(), 'packages/pivi-react/styles/components/context-footer.css'),
    'utf8',
  );

  it('uses the host tooltip only and has no interactive inspector styles', () => {
    expect(css).not.toContain('.pivi-context-meter-gauge::after');
    expect(css).not.toContain('.pivi-context-meter-gauge:hover::after');
    expect(css).toContain('box-shadow: none;');
    expect(css).not.toContain('.pivi-context-inspector');
  });
});
