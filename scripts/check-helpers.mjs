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
      const clause = node.importClause;
      let isTypeOnly = Boolean(clause?.isTypeOnly);
      if (
        !isTypeOnly
        && clause?.namedBindings
        && ts.isNamedImports(clause.namedBindings)
      ) {
        const elements = clause.namedBindings.elements;
        isTypeOnly = elements.length > 0 && elements.every((element) => element.isTypeOnly);
      }
      addSpecifier(node.moduleSpecifier, isTypeOnly);
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

export function collectNamedMethodCalls(file, methodName) {
  const sourceText = fs.readFileSync(file, 'utf8');
  const sourceFile = ts.createSourceFile(file, sourceText, ts.ScriptTarget.Latest, true);
  const calls = [];

  function unwrapExpression(node) {
    let current = node;
    while (
      ts.isParenthesizedExpression(current)
      || ts.isAsExpression(current)
      || ts.isNonNullExpression(current)
      || ts.isSatisfiesExpression(current)
    ) {
      current = current.expression;
    }
    return current;
  }

  function isNamedCall(expression) {
    const target = unwrapExpression(expression);
    if (ts.isIdentifier(target)) {
      return target.text === methodName;
    }
    if (ts.isPropertyAccessExpression(target)) {
      return target.name.text === methodName;
    }
    if (ts.isElementAccessExpression(target)) {
      const argument = target.argumentExpression
        ? unwrapExpression(target.argumentExpression)
        : null;
      return Boolean(ts.isStringLiteralLike(argument) && argument.text === methodName);
    }
    return false;
  }

  function visit(node) {
    if (ts.isCallExpression(node) && isNamedCall(node.expression)) {
      calls.push({
        methodName,
        line: sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1,
      });
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return calls;
}

export function collectNamedExportSpecifiers(file, exportNames) {
  const sourceText = fs.readFileSync(file, 'utf8');
  const sourceFile = ts.createSourceFile(file, sourceText, ts.ScriptTarget.Latest, true);
  const names = new Set(exportNames);
  const exports = [];

  function visit(node) {
    if (!ts.isExportDeclaration(node) || !node.exportClause || !ts.isNamedExports(node.exportClause)) {
      ts.forEachChild(node, visit);
      return;
    }
    for (const element of node.exportClause.elements) {
      const sourceName = (element.propertyName ?? element.name).text;
      if (names.has(sourceName)) {
        exports.push({
          methodName: sourceName,
          line: sourceFile.getLineAndCharacterOfPosition(element.getStart()).line + 1,
        });
      }
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return exports;
}

export function collectNamedPropertyAccesses(file, propertyNames) {
  const sourceText = fs.readFileSync(file, 'utf8');
  const sourceFile = ts.createSourceFile(file, sourceText, ts.ScriptTarget.Latest, true);
  const names = new Set(propertyNames);
  const accesses = [];

  function visit(node) {
    let propertyName = null;
    if (ts.isPropertyAccessExpression(node)) {
      propertyName = node.name.text;
    } else if (ts.isElementAccessExpression(node) && node.argumentExpression) {
      const argument = node.argumentExpression;
      if (ts.isStringLiteralLike(argument)) propertyName = argument.text;
    } else if (ts.isBindingElement(node)) {
      const bindingName = node.propertyName ?? node.name;
      if (ts.isIdentifier(bindingName) || ts.isStringLiteralLike(bindingName)) {
        propertyName = bindingName.text;
      }
    }
    if (propertyName && names.has(propertyName)) {
      accesses.push({
        methodName: propertyName,
        line: sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1,
      });
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return accesses;
}

export function collectNamedReceiverPropertyAccesses(
  file,
  receiverNames,
  propertyNames,
) {
  const sourceText = fs.readFileSync(file, 'utf8');
  const sourceFile = ts.createSourceFile(file, sourceText, ts.ScriptTarget.Latest, true);
  const receivers = new Set(receiverNames);
  const properties = new Set(propertyNames);
  const accesses = [];

  function visit(node) {
    let receiver = null;
    let propertyName = null;
    if (ts.isPropertyAccessExpression(node)) {
      receiver = node.expression;
      propertyName = node.name.text;
    } else if (ts.isElementAccessExpression(node) && node.argumentExpression) {
      receiver = node.expression;
      const argument = node.argumentExpression;
      if (ts.isStringLiteralLike(argument)) propertyName = argument.text;
    }
    if (
      receiver
      && ts.isIdentifier(receiver)
      && receivers.has(receiver.text)
      && propertyName
      && properties.has(propertyName)
    ) {
      accesses.push({
        methodName: propertyName,
        line: sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1,
      });
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return accesses;
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
  return resolved;
}

export function resolveSourceModuleFile(moduleName, fromFile, sourceFiles) {
  const base = resolveToSrcPath(moduleName, fromFile);
  if (!base) return null;
  const knownFiles = sourceFiles instanceof Set ? sourceFiles : new Set(sourceFiles);
  for (const candidate of [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    `${base}.mts`,
    `${base}.cts`,
    path.join(base, 'index.ts'),
    path.join(base, 'index.tsx'),
  ]) {
    const absolute = path.resolve(candidate);
    if (knownFiles.has(absolute)) return absolute;
  }
  return null;
}

export function isProductSrcImport(moduleName, fromFile) {
  if (moduleName.startsWith('@/')) {
    return true;
  }
  if (moduleName.startsWith('src/')) {
    return true;
  }
  const resolved = resolveToSrcPath(moduleName, fromFile);
  return resolved !== null && (resolved === srcDir || resolved.startsWith(srcDir + path.sep));
}

export function isRelativeProductSrcImport(moduleName, fromFile) {
  if (!moduleName.startsWith('.') && !moduleName.startsWith('/')) {
    return false;
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
