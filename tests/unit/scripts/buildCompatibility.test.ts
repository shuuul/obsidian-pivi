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
          define: production.define,
          jsx: production.jsx,
          jsxImportSource: production.jsxImportSource,
          external: production.external,
          metafile: production.metafile,
          write: production.write,
          plugins: production.plugins.map((plugin) => plugin.name),
        },
        analysis: {
          target: analysis.target,
          define: analysis.define,
          jsx: analysis.jsx,
          jsxImportSource: analysis.jsxImportSource,
          external: analysis.external,
          metafile: analysis.metafile,
          write: analysis.write,
          plugins: analysis.plugins.map((plugin) => plugin.name),
        },
      }));
    `);

    const options = JSON.parse(output) as {
      production: {
        target: string;
        define: Record<string, string>;
        jsx: string;
        jsxImportSource: string;
        external: string[];
        metafile: boolean;
        write: boolean;
        plugins: string[];
      };
      analysis: {
        target: string;
        define: Record<string, string>;
        jsx: string;
        jsxImportSource: string;
        external: string[];
        metafile: boolean;
        write: boolean;
        plugins: string[];
      };
    };

    expect(options.production).toMatchObject({
      target: 'es2022',
      define: { 'process.env.NODE_ENV': '"production"' },
      jsx: 'automatic',
      jsxImportSource: 'react',
      metafile: false,
      write: true,
    });
    expect(options.analysis).toMatchObject({
      target: 'es2022',
      define: { 'process.env.NODE_ENV': '"production"' },
      jsx: 'automatic',
      jsxImportSource: 'react',
      metafile: true,
      write: false,
    });
    for (const reactModule of ['react', 'react-dom', 'react-dom/client', 'react/jsx-runtime']) {
      expect(options.production.external).not.toContain(reactModule);
    }
    expect(options.analysis.plugins).toEqual(options.production.plugins);
  });

  it('rewrites dynamic node imports and rejects surviving node specifiers', () => {
    const output = runBuildContract(`
      import { rewriteDynamicNodeImports } from './build/postprocess/rewrite-node-imports.mjs';
      const rewritten = rewriteDynamicNodeImports('const fs = import("node:fs"); const crypto = import("crypto"); const fsp = loader("node:fs/promises"); const os = loader("node:os");');
      let rejected = false;
      try {
        rewriteDynamicNodeImports('const fs = import(factory("node:fs"));');
      } catch {
        rejected = true;
      }
      process.stdout.write(JSON.stringify({ rewritten, rejected }));
    `);

    const result = JSON.parse(output) as { rewritten: string; rejected: boolean };

    expect(result.rewritten).toBe('const fs = Promise.resolve(require("fs")); const crypto = Promise.resolve(require("crypto")); const fsp = Promise.resolve(require("fs/promises")); const os = Promise.resolve(require("os"));');
    expect(result.rejected).toBe(true);
  });

  it('keeps unique Pi shrinkwrap dependencies and package-import aliases resolvable', () => {
    const output = runBuildContract(`
      import path from 'path';
      import { build } from 'esbuild';
      import { dedupePiCodingAgentNested } from './build/plugins/dedupe-pi-dependencies.mjs';
      const root = process.cwd();
      await build({
        stdin: {
          contents: [
            'import chalk from "./node_modules/@earendil-works/pi-coding-agent/node_modules/chalk/source/index.js";',
            'import { Markdown } from "./node_modules/@earendil-works/pi-coding-agent/node_modules/@earendil-works/pi-tui/dist/components/markdown.js";',
            'void chalk.red; void Markdown;',
          ].join('\\n'),
          resolveDir: root,
        },
        bundle: true,
        platform: 'node',
        write: false,
        plugins: [dedupePiCodingAgentNested],
      });
      process.stdout.write('ok');
    `);

    expect(output).toBe('ok');
  });
});
