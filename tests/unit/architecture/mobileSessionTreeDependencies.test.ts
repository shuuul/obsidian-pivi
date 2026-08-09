import { builtinModules } from 'node:module';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, normalize, resolve } from 'node:path';
import ts from 'typescript';


const root = process.cwd();
const sessionDirectory = join(root, 'packages/pivi-agent-core/src/engine/pi/session');
const roots = [
  'piSessionTree.ts',
  'vaultPiSessionTree.ts',
  'piSessionTreeSemantics.ts',
  'piSessionJsonlDocument.ts',
  'sessionJsonlStorage.ts',
  'externalContextJsonl.ts',
  'mobileMessageMapper.ts',
  'vaultPiSessionStore.ts',
].map(file => join(sessionDirectory, file));
const builtins = new Set(builtinModules.flatMap(name => [name, `node:${name}`]));
const forbiddenProductionPath = /(?:sessionTreeStore|desktopPiSessionTree|sessionRecovery|loadVaultSkills|\/app\/|\/host\/|\/process\/|\/index)\.ts$/;

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
    imports.push({ moduleName: node.moduleSpecifier.text,
      line: source.getLineAndCharacterOfPosition(node.moduleSpecifier.getStart()).line + 1 });
  });
  return imports;
}

describe('Mobile session value-import graph', () => {
  it('is transitively browser/Vault-safe', () => {
    const queue = [...roots];
    const visited = new Set<string>();
    const failures: string[] = [];
    while (queue.length) {
      const file = normalize(queue.shift()!);
      if (visited.has(file)) continue;
      visited.add(file);
      for (const imported of valueImports(file)) {
        const edge = `${file.slice(root.length + 1)}:${imported.line} -> ${imported.moduleName}`;
        if (builtins.has(imported.moduleName)
          || imported.moduleName.startsWith('@earendil-works/pi-coding-agent')) {
          failures.push(edge);
          continue;
        }
        const target = resolveRelative(file, imported.moduleName);
        if (!target) continue;
        if (forbiddenProductionPath.test(target.replaceAll('\\', '/'))) failures.push(edge);
        else if (target.startsWith(join(root, 'packages/pivi-agent-core/src'))) queue.push(target);
      }
    }
    expect(failures).toEqual([]);
    expect([...visited].map(file => file.slice(root.length + 1))).toContain(
      'packages/pivi-agent-core/src/engine/pi/session/mobileMessageMapper.ts',
    );
  });
});
