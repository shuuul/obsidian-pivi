import { execFileSync } from 'child_process';
import { mkdtempSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const rootDir = process.cwd();
const packageVersion = (
  JSON.parse(readFileSync('package.json', 'utf8')) as { version: string }
).version;

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
      import { gunzipSync } from 'node:zlib';
      const production = createBuildOptions({ production: true });
      const analysis = createBuildOptions({ production: true, metafile: true, write: false });
      const embeddedSkillsCli = Buffer.from(
        JSON.parse(production.define.__PIVI_EMBEDDED_SKILLS_CLI_GZIP_BASE64__),
        'base64',
      );
      const embeddedSkillsCliSource = gunzipSync(embeddedSkillsCli);
      process.stdout.write(JSON.stringify({
        production: {
          target: production.target,
          define: { 'process.env.NODE_ENV': production.define['process.env.NODE_ENV'] },
          banner: production.banner,
          jsx: production.jsx,
          jsxImportSource: production.jsxImportSource,
          external: production.external,
          metafile: production.metafile,
          write: production.write,
          plugins: production.plugins.map((plugin) => plugin.name),
        },
        analysis: {
          target: analysis.target,
          define: { 'process.env.NODE_ENV': analysis.define['process.env.NODE_ENV'] },
          banner: analysis.banner,
          jsx: analysis.jsx,
          jsxImportSource: analysis.jsxImportSource,
          external: analysis.external,
          metafile: analysis.metafile,
          write: analysis.write,
          plugins: analysis.plugins.map((plugin) => plugin.name),
        },
        embeddedSkillsCli: {
          compressedBytes: embeddedSkillsCli.byteLength,
          operatingSystem: embeddedSkillsCli[9],
          sourceBytes: embeddedSkillsCliSource.byteLength,
          hasCreateRequireBanner: embeddedSkillsCliSource
            .toString('utf8')
            .includes('__piviCreateRequire'),
        },
      }));
    `);

    const options = JSON.parse(output) as {
      production: {
        target: string;
        define: Record<string, string>;
        banner: Record<string, string>;
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
        banner: Record<string, string>;
        jsx: string;
        jsxImportSource: string;
        external: string[];
        metafile: boolean;
        write: boolean;
        plugins: string[];
      };
      embeddedSkillsCli: {
        compressedBytes: number;
        operatingSystem: number;
        sourceBytes: number;
        hasCreateRequireBanner: boolean;
      };
    };

    expect(options.production).toMatchObject({
      target: 'es2022',
      define: { 'process.env.NODE_ENV': '"production"' },
      banner: { js: `/* Pivi ${packageVersion} */` },
      jsx: 'automatic',
      jsxImportSource: 'react',
      metafile: false,
      write: true,
    });
    expect(options.analysis).toMatchObject({
      target: 'es2022',
      define: { 'process.env.NODE_ENV': '"production"' },
      banner: { js: `/* Pivi ${packageVersion} */` },
      jsx: 'automatic',
      jsxImportSource: 'react',
      metafile: true,
      write: false,
    });
    for (const reactModule of ['react', 'react-dom', 'react-dom/client', 'react/jsx-runtime']) {
      expect(options.production.external).not.toContain(reactModule);
    }
    expect(options.analysis.plugins).toEqual(options.production.plugins);
    expect(options.embeddedSkillsCli.compressedBytes)
      .toBeLessThan(options.embeddedSkillsCli.sourceBytes);
    expect(options.embeddedSkillsCli.operatingSystem).toBe(255);
    expect(options.embeddedSkillsCli.hasCreateRequireBanner).toBe(true);
  });

  it('fails the community audit when the bundle references plugin self files', () => {
    const output = runBuildContract(`
      import { build } from 'esbuild';
      import { assertCommunityAudit } from './build/plugins/assert-community-audit.mjs';
      const attempt = async (contents) => {
        try {
          const result = await build({
            stdin: { contents, resolveDir: process.cwd() },
            bundle: true,
            platform: 'node',
            write: false,
            outfile: 'main.js',
            plugins: [assertCommunityAudit],
            logLevel: 'silent',
          });
          return result.errors.map((error) => error.text);
        } catch (error) {
          return (error.errors ?? []).map((entry) => entry.text);
        }
      };
      process.stdout.write(JSON.stringify({
        clean: await attempt('export const answer = 42;'),
        manifest: await attempt('export const target = "plugins/note-toolbar/manifest.json";'),
        mainJs: await attempt('export const file = "main.js";'),
      }));
    `);

    const result = JSON.parse(output) as {
      clean: string[];
      manifest: string[];
      mainJs: string[];
    };

    expect(result.clean).toEqual([]);
    expect(result.manifest).toEqual([
      'Community audit failed: found plugin self-file reference "manifest.json" in main.js',
    ]);
    expect(result.mainJs).toEqual([
      'Community audit failed: found plugin self-file reference "main.js" in main.js',
    ]);
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

  it('provides the callable CommonJS signal-exit shape expected by proper-lockfile', () => {
    const output = runBuildContract(`
      import { createRequire } from 'node:module';
      const require = createRequire(import.meta.url);
      const signalExit = require('./packages/engine-pi/src/shims/signalExit.cjs');
      const unregister = signalExit(() => {});
      process.stdout.write(JSON.stringify({
        callable: typeof signalExit === 'function',
        unregister: typeof unregister === 'function',
        signals: signalExit.signals,
      }));
    `);

    expect(JSON.parse(output)).toEqual({ callable: true, unregister: true, signals: [] });
  });

  it('resolves yaml to its tree-shakeable ESM build', () => {
    const inputs = JSON.parse(runBuildContract(`
      import { build } from 'esbuild';
      import { preferBrowserBuilds } from './build/plugins/prefer-browser-builds.mjs';
      const result = await build({
        stdin: { resolveDir: process.cwd(), contents: "import { parse } from 'yaml'; console.log(parse('a: 1'));" },
        bundle: true,
        platform: 'node',
        format: 'cjs',
        plugins: [preferBrowserBuilds],
        write: false,
        metafile: true,
        logLevel: 'silent',
      });
      process.stdout.write(JSON.stringify(Object.keys(result.metafile.inputs)));
    `)) as string[];

    expect(inputs).toContain('node_modules/yaml/browser/index.js');
    expect(inputs.filter((input) => input.startsWith('node_modules/yaml/dist/'))).toEqual([]);
  });

  it('routes the web build of the real Google SDK through the bundled scoped fetch', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'pivi-google-fetch-'));
    const outfile = join(tempDir, 'google-fetch.cjs');
    try {
      const contents = `
            import { googleProvider } from '@earendil-works/pi-ai/providers/google';
            import { installBundledFetch } from './packages/obsidian-host/src/bundledFetch';
            import { withScopedGoogleTransport } from './packages/engine-pi/src/models/scopedGoogleProvider';

            void (async () => {
              let ambientCalls = 0;
              let scopedCalls = 0;
              globalThis.fetch = (async () => {
                ambientCalls += 1;
                throw new Error('ambient fetch must not be called');
              }) as typeof fetch;
              const scopedFetch = async () => {
                scopedCalls += 1;
                return new Response(
                  'data: {"candidates":[{"content":{"parts":[{"text":"ok"}],"role":"model"},"finishReason":"STOP"}],"usageMetadata":{"promptTokenCount":1,"candidatesTokenCount":1,"totalTokenCount":2}}\\n\\n',
                  { status: 200, headers: { 'content-type': 'text/event-stream' } },
                );
              };

              installBundledFetch(scopedFetch);
              const provider = withScopedGoogleTransport(googleProvider(), () => scopedFetch);
              const model = provider.getModels()[0];
              if (!model) throw new Error('Google provider has no models');
              const result = await provider.streamSimple(
                model,
                { messages: [{ role: 'user', content: 'hello', timestamp: 1 }] },
                { apiKey: 'test-key', fetch: scopedFetch },
              ).result();
              process.stdout.write(JSON.stringify({
                ambientCalls,
                scopedCalls,
                stopReason: result.stopReason,
                errorMessage: result.errorMessage,
                text: result.content.find((part) => part.type === 'text')?.text,
              }));
            })().catch((error) => {
              console.error(error);
              process.exitCode = 1;
            });
          `;
      // esbuild plugins need the async API, so the production resolver runs in a child process.
      const bundledInputs = JSON.parse(runBuildContract(`
        import { build } from 'esbuild';
        import { preferBrowserBuilds } from './build/plugins/prefer-browser-builds.mjs';
        const result = await build({
          stdin: {
            resolveDir: ${JSON.stringify(rootDir)},
            sourcefile: 'google-fetch-contract.ts',
            loader: 'ts',
            contents: ${JSON.stringify(contents)},
          },
          bundle: true,
          platform: 'node',
          format: 'cjs',
          target: 'es2022',
          plugins: [preferBrowserBuilds],
          inject: ['./packages/obsidian-host/src/bundledFetch.ts'],
          outfile: ${JSON.stringify(outfile)},
          metafile: true,
          logLevel: 'silent',
        });
        process.stdout.write(JSON.stringify(Object.keys(result.metafile.inputs)));
      `)) as string[];
      // The Node build of the SDK would pull its Vertex/ADC auth and socket stack.
      expect(bundledInputs.filter((input) => /node_modules\/(google-auth-library|ws|gaxios|node-fetch)\//.test(input))).toEqual([]);
      expect(bundledInputs).toContain('node_modules/@google/genai/dist/web/index.mjs');

      const output = execFileSync(process.execPath, [outfile], { encoding: 'utf8' });
      expect(JSON.parse(output)).toEqual({
        ambientCalls: 0,
        scopedCalls: 1,
        stopReason: 'stop',
        text: 'ok',
      });
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
