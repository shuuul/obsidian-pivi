import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import * as agentCoreMock from '@earendil-works/pi-agent-core';
import * as aiMock from '@earendil-works/pi-ai';
import * as codingAgentMock from '@earendil-works/pi-coding-agent';
import * as envApiKeysShim from '@pivi/engine-pi/shims/piAiEnvApiKeys';
import ts from 'typescript';

/**
 * Jest maps the Pi SDK roots to hand-written mocks, so engine tests cannot notice an
 * upstream export that was renamed or removed. For every runtime value the product
 * source imports from a mocked root, require the installed package and the mock to
 * both still export it.
 */
const rootDir = process.cwd();
const installedDir = join(rootDir, 'node_modules', '@earendil-works');

// The production build narrows the pi-coding-agent root to these modules because the
// root entrypoint statically loads its CLI and TUI.
const packages = [
  { name: '@earendil-works/pi-agent-core', mock: agentCoreMock, modules: ['pi-agent-core/dist/index.js'] },
  { name: '@earendil-works/pi-ai', mock: aiMock, modules: ['pi-ai/dist/index.js'] },
  {
    name: '@earendil-works/pi-coding-agent',
    mock: codingAgentMock,
    modules: [
      'pi-coding-agent/dist/core/session-manager.js',
      'pi-coding-agent/dist/core/compaction/index.js',
      'pi-coding-agent/dist/core/messages.js',
    ],
  },
];

function listSourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) return [];
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return listSourceFiles(path);
    return /\.tsx?$/.test(entry.name) && !entry.name.endsWith('.d.ts') ? [path] : [];
  });
}

function collectValueImports(): Map<string, Set<string>> {
  const imports = new Map<string, Set<string>>(packages.map(({ name }) => [name, new Set<string>()]));
  for (const file of ['src', 'packages'].flatMap((dir) => listSourceFiles(join(rootDir, dir)))) {
    const text = readFileSync(file, 'utf8');
    if (!text.includes('@earendil-works/')) continue;
    const source = ts.createSourceFile(file, text, ts.ScriptTarget.ES2022);
    for (const statement of source.statements) {
      if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
      const names = imports.get(statement.moduleSpecifier.text);
      const bindings = statement.importClause?.namedBindings;
      if (!names || statement.importClause?.phaseModifier === ts.SyntaxKind.TypeKeyword || !bindings || !ts.isNamedImports(bindings)) continue;
      for (const element of bindings.elements) {
        if (!element.isTypeOnly) names.add((element.propertyName ?? element.name).text);
      }
    }
  }
  return imports;
}

function installedExports(modules: string[]): Set<string> {
  const urls = modules.map((module) => pathToFileURL(join(installedDir, module)).href);
  const script = `
    const names = new Set();
    for (const url of ${JSON.stringify(urls)}) for (const name of Object.keys(await import(url))) names.add(name);
    process.stdout.write(JSON.stringify([...names]));
  `;
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(result.stderr);
  return new Set(JSON.parse(result.stdout) as string[]);
}

describe('Pi SDK mock export compatibility', () => {
  const valueImports = collectValueImports();

  it.each(packages)('keeps every runtime import of $name exported upstream and mocked', ({ name, mock, modules }) => {
    const imported = [...(valueImports.get(name) ?? [])].sort();
    const installed = installedExports(modules);

    expect(imported.length).toBeGreaterThan(0);
    expect(imported.filter((exported) => !installed.has(exported))).toEqual([]);
    expect(imported.filter((exported) => !(exported in mock))).toEqual([]);
  });

  // The production build aliases upstream env-api-keys.js to this shim, so an export
  // upstream adds must exist here or the bundle fails to link.
  it('keeps the env-api-keys shim exporting everything upstream exports', () => {
    const upstream = installedExports(['pi-ai/dist/env-api-keys.js']);

    expect([...upstream].filter((exported) => !(exported in envApiKeysShim))).toEqual([]);
  });
});
