import { execFileSync } from 'child_process';

const rootDir = process.cwd();

function runMinify(input: string): string {
  return execFileSync(
    'node',
    [
      '--input-type=module',
      '-e',
      `import { minifyCss } from './scripts/build-css.mjs';
const input = Buffer.from(process.argv[1], 'base64').toString('utf8');
process.stdout.write(minifyCss(input));`,
      Buffer.from(input, 'utf8').toString('base64'),
    ],
    { cwd: rootDir, encoding: 'utf8' },
  );
}

describe('build CSS minifier', () => {
  it('preserves Style Settings comments while removing ordinary comments', () => {
    const output = runMinify(`
      /* ordinary comment */
      /* @settings
      name: Pivi
      id: pivi
      settings:
        -
          id: pivi-chat-font-size
          title: Chat message font size
          type: variable-number-slider
          default: 14
      */
      .pivi-message-content {
        /* another ordinary comment */
        font-size: var(--pivi-chat-font-size, 14px);
      }
      /* @settings
      name: Extra
      id: extra
      settings:
        -
          id: extra-size
          title: Extra size
          type: variable-number-slider
          default: 1
      */
      .pivi-extra { color: red; }
    `);

    expect(output).toContain('/* @settings\n      name: Pivi');
    expect(output).toContain('/* @settings\n      name: Extra');
    expect(output).toContain('font-size:var(--pivi-chat-font-size,14px)');
    expect(output).toContain('.pivi-extra{color:red;}');
    expect(output).not.toContain('ordinary comment');
    expect(output).not.toContain('another ordinary comment');
    expect((output.match(/\/\* @settings/g) ?? []).length).toBe(2);
  });
});
