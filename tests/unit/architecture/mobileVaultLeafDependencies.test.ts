import { builtinModules } from 'node:module';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, normalize, resolve } from 'node:path';
import ts from 'typescript';

const root = process.cwd();
const builtins = new Set(builtinModules.flatMap(name => [name, `node:${name}`]));

const leaves = [
  {
    name: '@pivi/obsidian-tools/mobile',
    entry: join(root, 'packages/obsidian-tools/src/mobile.ts'),
    packageRoot: join(root, 'packages/obsidian-tools/src'),
  },
  {
    name: '@pivi/obsidian-host/mobile',
    entry: join(root, 'packages/obsidian-host/src/mobile.ts'),
    packageRoot: join(root, 'packages/obsidian-host/src'),
  },
] as const;

const forbiddenSpecifier = /^(?:electron(?:\/|$)|@pivi\/obsidian-host(?:$|\/(?!mobile(?:\/|$)))|@pivi\/obsidian-tools(?:$|\/(?!mobile(?:\/|$))))/;
const forbiddenPath = /(?:^|\/)(?:index|fileRecoverySnapshot|externalFileApi|systemProcessRunner|electronCompat|nodeFetch|bundledFetch|createPiviNetworkClients|openExternalUrl|providerLegacyAuthStore|authContextHost|cli\/|process\/|secrets\/|storage\/|bootstrap\/|settings\/|shims\/|bash\.ts|bashAllowlist|loginShell|readExternal|listExternal|command\.ts|eval\.ts|history\.ts|daily\.ts|tasks\.ts|generateImage|base\.ts|openPath|createObsidianTools|deps\.ts)(?:\.ts)?$/;

function resolveRelative(source: string, specifier: string): string | null {
  if (!specifier.startsWith('.')) return null;
  const base = resolve(dirname(source), specifier);
  return [base, `${base}.ts`, join(base, 'index.ts')].find(existsSync) ?? null;
}

function valueImports(file: string): Array<{ moduleName: string; line: number }> {
  const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
  const imports: Array<{ moduleName: string; line: number }> = [];
  source.forEachChild(node => {
    if (!ts.isImportDeclaration(node) && !ts.isExportDeclaration(node)) return;
    const clause = ts.isImportDeclaration(node) ? node.importClause : undefined;
    const named = clause?.namedBindings;
    const typeOnly = ts.isExportDeclaration(node)
      ? node.isTypeOnly
      : clause?.phaseModifier === ts.SyntaxKind.TypeKeyword
      || (named && ts.isNamedImports(named) && named.elements.length > 0
        && named.elements.every(element => element.isTypeOnly));
    if (typeOnly || !node.moduleSpecifier || !ts.isStringLiteralLike(node.moduleSpecifier)) return;
    imports.push({
      moduleName: node.moduleSpecifier.text,
      line: source.getLineAndCharacterOfPosition(node.moduleSpecifier.getStart()).line + 1,
    });
  });
  return imports;
}

describe('Mobile vault tool/host leaf value-import graph', () => {
  it.each(leaves)('$name is transitively free of Node/Electron/CLI/external/private recovery/root barrels', ({ entry, packageRoot, name }) => {
    const queue = [entry];
    const visited = new Set<string>();
    const failures: string[] = [];

    while (queue.length) {
      const file = normalize(queue.shift()!);
      if (visited.has(file)) continue;
      visited.add(file);
      for (const imported of valueImports(file)) {
        const edge = `${file.slice(root.length + 1)}:${imported.line} -> ${imported.moduleName}`;
        if (builtins.has(imported.moduleName)
          || imported.moduleName === 'process'
          || imported.moduleName.startsWith('node:')
          || forbiddenSpecifier.test(imported.moduleName)) {
          failures.push(edge);
          continue;
        }
        const target = resolveRelative(file, imported.moduleName);
        if (!target) continue;
        const rel = target.replaceAll('\\', '/');
        if (forbiddenPath.test(rel) || /\/packages\/obsidian-host\/src\/index\.ts$/.test(rel)
          || /\/packages\/obsidian-tools\/src\/index\.ts$/.test(rel)) {
          failures.push(edge);
          continue;
        }
        if (target.startsWith(packageRoot) || target.startsWith(join(root, 'packages/pivi-agent-core/src'))) {
          queue.push(target);
        } else if (target.startsWith(join(root, 'packages/obsidian-host/src'))
          || target.startsWith(join(root, 'packages/obsidian-tools/src'))) {
          // Cross-package relative should not happen; package imports are checked above.
          queue.push(target);
        }
      }
    }

    expect(failures).toEqual([]);
    expect(visited.has(normalize(entry))).toBe(true);
    expect(name).toMatch(/mobile/);
  });
});
