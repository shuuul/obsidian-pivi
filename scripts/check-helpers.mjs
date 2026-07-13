import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

export const rootDir = process.cwd();
export const srcDir = path.join(rootDir, 'src');

export function listSourceFiles(dir, options = {}) {
  const { extensions = /\.[cm]?[tj]sx?$/ } = options;
  if (!fs.existsSync(dir)) {
    return [];
  }
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  return entries.flatMap((entry) => {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'coverage' || entry.name === 'dist') {
        return [];
      }
      return listSourceFiles(fullPath, options);
    }
    return entry.isFile() && extensions.test(entry.name) ? [fullPath] : [];
  });
}

export function collectModuleSpecifiers(file) {
  const sourceText = fs.readFileSync(file, 'utf8');
  const sourceFile = ts.createSourceFile(file, sourceText, ts.ScriptTarget.Latest, true);
  const specifiers = [];

  function addSpecifier(node, isTypeOnly = false) {
    if (node && ts.isStringLiteralLike(node)) {
      specifiers.push({
        moduleName: node.text,
        line: sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1,
        isTypeOnly,
      });
    }
  }

  function visit(node) {
    if (ts.isImportDeclaration(node)) {
      addSpecifier(node.moduleSpecifier, Boolean(node.importClause?.isTypeOnly));
    } else if (ts.isExportDeclaration(node)) {
      addSpecifier(node.moduleSpecifier, Boolean(node.isTypeOnly));
    } else if (ts.isCallExpression(node)) {
      if (node.expression.kind === ts.SyntaxKind.ImportKeyword) {
        addSpecifier(node.arguments[0]);
      } else if (ts.isIdentifier(node.expression) && node.expression.text === 'require') {
        addSpecifier(node.arguments[0]);
      }
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return specifiers;
}

export function isForbidden(moduleName, forbidden) {
  return forbidden.some((pattern) => pattern.test(moduleName));
}

export function resolveToSrcPath(moduleName, fromFile) {
  if (moduleName.startsWith('@/')) {
    return path.join(srcDir, moduleName.slice(2));
  }
  if (moduleName === '@/main' || moduleName === '@') {
    return path.join(srcDir, 'main.ts');
  }
  if (moduleName.startsWith('src/')) {
    return path.join(rootDir, moduleName);
  }
  if (!moduleName.startsWith('.') && !moduleName.startsWith('/')) {
    return null;
  }
  const resolved = path.resolve(path.dirname(fromFile), moduleName);
  const relative = path.relative(rootDir, resolved);
  if (relative.startsWith('..')) {
    return null;
  }
  if (relative.startsWith('src' + path.sep) || relative === 'src') {
    return resolved;
  }
  return null;
}

export function isProductSrcImport(moduleName, fromFile) {
  const relativeFrom = path.relative(rootDir, fromFile).replaceAll('\\', '/');
  if (relativeFrom.startsWith('tests/')) {
    return false;
  }
  if (moduleName.startsWith('@/')) {
    return true;
  }
  if (moduleName.startsWith('src/')) {
    return true;
  }
  const resolved = resolveToSrcPath(moduleName, fromFile);
  return resolved !== null && (resolved === srcDir || resolved.startsWith(srcDir + path.sep));
}

export function loadJsonConfig(relativePath) {
  const absolutePath = path.join(rootDir, relativePath);
  if (!fs.existsSync(absolutePath)) {
    return null;
  }
  return JSON.parse(fs.readFileSync(absolutePath, 'utf8'));
}

export function isExportOnlySource(sourceText, fileLabel) {
  const sourceFile = ts.createSourceFile(fileLabel, sourceText, ts.ScriptTarget.Latest, true);
  return sourceFile.statements.every(
    (statement) =>
      ts.isExportDeclaration(statement) ||
      ts.isEmptyStatement(statement) ||
      ts.isExpressionStatement(statement) && ts.isStringLiteral(statement.expression),
  );
}
