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
  it('uses the shared runtime settings and embeds a runnable standalone Skills CLI', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'pivi-skills-bundle-'));
    const cli = join(tempDir, 'skills.mjs');
    try {
      const options = JSON.parse(runBuildContract(`
        import { writeFileSync } from 'node:fs';
        import { gunzipSync } from 'node:zlib';
        import { createBuildOptions } from './build/create-build-options.mjs';
        const { input, output, skillsCliGzipBytes } = await createBuildOptions({ production: true });
        const { __PIVI_EMBEDDED_SKILLS_CLI_GZIP_BASE64__: cli, ...define } = input.transform.define;
        const compressed = Buffer.from(JSON.parse(cli), 'base64');
        writeFileSync(${JSON.stringify(cli)}, gunzipSync(compressed));
        process.stdout.write(JSON.stringify({
          target: input.transform.target,
          define,
          jsx: input.transform.jsx,
          external: input.external,
          format: output.format,
          codeSplitting: output.codeSplitting,
          banner: output.banner,
          minify: output.minify,
          operatingSystem: compressed[9],
          hasCorrectCliSize: compressed.byteLength === skillsCliGzipBytes,
        }));
      `)) as { external: string[] };
      expect(options).toMatchObject({
        target: 'es2022',
        define: {
          'process.env.NODE_ENV': '"production"',
          __PIVI_RELEASE_VERSION__: JSON.stringify(packageVersion),
        },
        jsx: { runtime: 'automatic', importSource: 'react' },
        format: 'cjs',
        codeSplitting: false,
        banner: `/* Pivi ${packageVersion} */`,
        minify: true,
        operatingSystem: 255,
        hasCorrectCliSize: true,
      });
      for (const reactModule of ['react', 'react-dom', 'react-dom/client', 'react/jsx-runtime']) {
        expect(options.external).not.toContain(reactModule);
      }
      expect(execFileSync(process.execPath, [cli, '--version'], { encoding: 'utf8' }).trim())
        .toMatch(/^\d+\.\d+\.\d+/);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('fails the community audit when the bundle references plugin self files', () => {
    const output = runBuildContract(`
      import { rolldown } from 'rolldown';
      import { assertCommunityAudit } from './build/plugins/assert-community-audit.mjs';
      const attempt = async (contents) => {
        const bundle = await rolldown({
          input: '\\0fixture',
          plugins: [
            { name: 'fixture', resolveId: (id) => id, load: () => contents },
            assertCommunityAudit,
          ],
        });
        try {
          await bundle.generate({ file: 'main.js', format: 'cjs' });
          return '';
        } catch (error) {
          return error.message;
        } finally {
          await bundle.close();
        }
      };
      process.stdout.write(JSON.stringify({
        clean: await attempt('export const answer = 42;'),
        manifest: await attempt('export const target = "plugins/note-toolbar/manifest.json";'),
        mainJs: await attempt('export const file = "main.js";'),
      }));
    `);

    const result = JSON.parse(output) as { clean: string; manifest: string; mainJs: string };
    expect(result.clean).toBe('');
    expect(result.manifest).toContain(
      'Community audit failed: found plugin self-file reference "manifest.json" in main.js',
    );
    expect(result.mainJs).toContain(
      'Community audit failed: found plugin self-file reference "main.js" in main.js',
    );
  });

  it('rewrites dynamic node imports and rejects surviving node specifiers', () => {
    const output = runBuildContract(`
      import { rewriteDynamicNodeImports } from './build/postprocess/rewrite-node-imports.mjs';
      const rewritten = rewriteDynamicNodeImports('const fs = import("node:fs"); const crypto = import("crypto"); const fsp = importNodeModule("node:fs/promises"); const os = importNodeModule("node:os");').code;
      const inert = rewriteDynamicNodeImports(\`// import("node:" + "fs")
const message = "Try import('node:buffer')";\`);
      let rejected = false;
      try {
        rewriteDynamicNodeImports('const fs = import(factory("node:fs"));');
      } catch {
        rejected = true;
      }
      process.stdout.write(JSON.stringify({ rewritten, rejected, inert }));
    `);

    const result = JSON.parse(output) as { rewritten: string; rejected: boolean; inert: null };

    expect(result.rewritten).toBe('const fs = Promise.resolve(require("fs")); const crypto = Promise.resolve(require("crypto")); const fsp = Promise.resolve(require("fs/promises")); const os = Promise.resolve(require("os"));');
    expect(result.rejected).toBe(true);
    expect(result.inert).toBeNull();
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
      import { rolldown } from 'rolldown';
      import { join, relative } from 'node:path';
      import { preferBrowserBuilds } from './build/plugins/prefer-browser-builds.mjs';
      const fixture = join(process.cwd(), 'yaml-contract.mjs');
      const bundle = await rolldown({
        input: fixture,
        platform: 'node',
        plugins: [
          { name: 'fixture', resolveId: (id) => id === fixture ? id : null,
            load: (id) => id === fixture ? "import { parse } from 'yaml'; console.log(parse('a: 1'));" : null },
          preferBrowserBuilds,
        ],
      });
      try {
        const { output: [chunk] } = await bundle.generate({ format: 'cjs' });
        process.stdout.write(JSON.stringify(chunk.moduleIds.map((id) => relative(process.cwd(), id).split('\\\\').join('/'))));
      } finally {
        await bundle.close();
      }
    `)) as string[];

    expect(inputs).toContain('node_modules/yaml/browser/index.js');
    expect(inputs.filter((input) => input.startsWith('node_modules/yaml/dist/'))).toEqual([]);
  });

  it('routes the web build of the real Google SDK through the explicit scoped fetch', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'pivi-google-fetch-'));
    const outfile = join(tempDir, 'google-fetch.cjs');
    try {
      const contents = `
            import { googleProvider } from '@earendil-works/pi-ai/providers/google';
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
      const bundledInputs = JSON.parse(runBuildContract(`
        import { rolldown } from 'rolldown';
        import { join, relative } from 'node:path';
        import { createBuildOptions } from './build/create-build-options.mjs';
        const { input } = await createBuildOptions({ production: true });
        const fixture = join(process.cwd(), 'google-fetch-contract.ts');
        const bundle = await rolldown({
          ...input,
          input: fixture,
          plugins: [
            { name: 'fixture', resolveId: (id) => id === fixture ? id : null,
              load: (id) => id === fixture ? ${JSON.stringify(contents)} : null },
            ...input.plugins.filter((plugin) => plugin.name === 'prefer-browser-builds'),
          ],
        });
        try {
          const { output: [chunk] } = await bundle.write({
            file: ${JSON.stringify(outfile)}, format: 'cjs', codeSplitting: false,
          });
          process.stdout.write(JSON.stringify(chunk.moduleIds.map((id) => relative(process.cwd(), id).split('\\\\').join('/'))));
        } finally {
          await bundle.close();
        }
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
