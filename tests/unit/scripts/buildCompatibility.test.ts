import { execFileSync } from 'child_process';

const rootDir = process.cwd();

function runBuildContract(code: string): string {
  return execFileSync('node', ['--input-type=module', '--eval', code], {
    cwd: rootDir,
    encoding: 'utf8',
  });
}

describe('shared build compatibility', () => {
  it('uses the same ES2022 runtime options for production and analysis', () => {
    const output = runBuildContract(`
      import { createBuildOptions } from './build/create-build-options.mjs';
      const production = createBuildOptions({ production: true });
      const analysis = createBuildOptions({ production: true, metafile: true, write: false });
      process.stdout.write(JSON.stringify({
        production: {
          target: production.target,
          metafile: production.metafile,
          write: production.write,
          plugins: production.plugins.map((plugin) => plugin.name),
        },
        analysis: {
          target: analysis.target,
          metafile: analysis.metafile,
          write: analysis.write,
          plugins: analysis.plugins.map((plugin) => plugin.name),
        },
      }));
    `);

    const options = JSON.parse(output) as {
      production: { target: string; metafile: boolean; write: boolean; plugins: string[] };
      analysis: { target: string; metafile: boolean; write: boolean; plugins: string[] };
    };

    expect(options.production).toMatchObject({ target: 'es2022', metafile: false, write: true });
    expect(options.analysis).toMatchObject({ target: 'es2022', metafile: true, write: false });
    expect(options.analysis.plugins).toEqual(options.production.plugins);
  });

  it('rewrites dynamic node imports and rejects surviving node specifiers', () => {
    const output = runBuildContract(`
      import { rewriteDynamicNodeImports } from './build/postprocess/rewrite-node-imports.mjs';
      const rewritten = rewriteDynamicNodeImports('const fs = import("node:fs"); const crypto = import("crypto");');
      let rejected = false;
      try {
        rewriteDynamicNodeImports('const fs = import(factory("node:fs"));');
      } catch {
        rejected = true;
      }
      process.stdout.write(JSON.stringify({ rewritten, rejected }));
    `);

    const result = JSON.parse(output) as { rewritten: string; rejected: boolean };

    expect(result.rewritten).toBe('const fs = Promise.resolve(require("fs")); const crypto = Promise.resolve(require("crypto"));');
    expect(result.rejected).toBe(true);
  });
});
