import { execFileSync } from 'child_process';
import { readdirSync } from 'fs';
import { join, relative } from 'path';

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

function getStyleModules(): string[] {
  const output = execFileSync(
    'node',
    [
      '--input-type=module',
      '-e',
      "import { styleModules } from './packages/obsidian-react/styles/manifest.mjs'; process.stdout.write(JSON.stringify(styleModules));",
    ],
    { cwd: rootDir, encoding: 'utf8' },
  );
  return JSON.parse(output) as string[];
}

function listCssFiles(dir: string, baseDir = dir): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return listCssFiles(path, baseDir);
    return entry.isFile() && entry.name.endsWith('.css')
      ? [relative(baseDir, path).split('\\').join('/')]
      : [];
  });
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

describe('UI package style manifest', () => {
  it('preserves cascade order and lists every CSS module exactly once', () => {
    const styleModules = getStyleModules();
    const styleDir = join(rootDir, 'packages', 'obsidian-react', 'styles');

    expect(styleModules.slice(0, 3)).toEqual([
      'base/variables.css',
      'base/container.css',
      'base/animations.css',
    ]);
    expect(styleModules.slice(-6)).toEqual([
      'modals/mcp-modal.css',
      'settings/base.css',
      'settings/slash-settings.css',
      'settings/mcp-settings.css',
      'settings/agent-settings.css',
      'accessibility.css',
    ]);
    expect(new Set(styleModules).size).toBe(styleModules.length);
    expect([...styleModules].sort()).toEqual(listCssFiles(styleDir).sort());
  });
});
