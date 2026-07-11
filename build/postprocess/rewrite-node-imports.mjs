import { readFileSync, writeFileSync } from 'fs';
import path from 'path';

const forbiddenNodeImportPatterns = [
  /import\([^)]*node:/,
  /=>import\([^)]*\),\w+="node:/,
  /require\((['"])node:/,
];

/**
 * Dynamic `import("node:…")` is resolved as a URL fetch in Electron's renderer and fails.
 * Rewrite to `require()` wrapped in Promise for CJS bundles.
 */
export function rewriteDynamicNodeImports(source) {
  let rewritten = source;

  rewritten = rewritten.replace(
    /import\((['"])node:([^'"]+)\1\)/g,
    'Promise.resolve(require($1$2$1))',
  );

  rewritten = rewritten.replace(
    /require\((['"])node:([^'"]+)\1\)/g,
    'require($1$2$1)',
  );

  rewritten = rewritten.replace(
    /import\((['"])crypto\1\)/g,
    'Promise.resolve(require($1crypto$1))',
  );

  // pi-ai env-api-keys lazy loader (survives if shim missed a duplicate bundle)
  rewritten = rewritten.replace(
    /(\w+)=e=>import\((\w+)\(e\)\),(\w+)="node:fs",(\w+)="node:os",(\w+)="node:path";typeof process!="undefined"&&\([^)]+\)&&\(\1\(\3\)\.then\(e=>\{(\w+)=e\.existsSync\}\),\1\(\4\)\.then\(e=>\{(\w+)=e\.homedir\}\),\1\(\5\)\.then\(e=>\{(\w+)=e\.join\}\)\)/g,
    'typeof process!="undefined"&&($6=require("fs").existsSync,$7=require("os").homedir,$8=require("path").join)',
  );

  // pi-ai model auth helpers use a generic dynamic import loader for node builtins.
  rewritten = rewritten
    .replace(/(\w+)\("node:fs\/promises"\)/g, 'Promise.resolve(require("fs/promises"))')
    .replace(/(\w+)\("node:os"\)/g, 'Promise.resolve(require("os"))');

  // pi-ai openai-codex-responses lazy node:os loader (nested parens in process guard)
  rewritten = rewritten.replace(
    /(\w+)=\w+=>import\((\w+)\(\w+\)\),(\w+)="node:os";typeof process!="undefined"&&.*?&&\1\(\3\)\.then\(\w+=>\{(\w+)=\w+\}\)/g,
    'typeof process!="undefined"&&($4=require("os"))',
  );

  if (forbiddenNodeImportPatterns.some((pattern) => pattern.test(rewritten))) {
    throw new Error('Build output still contains node: imports/requires. Update rewriteDynamicNodeImports().');
  }

  return rewritten;
}

export function rewriteDynamicNodeImportsFile(bundlePath) {
  const source = readFileSync(bundlePath, 'utf-8');
  const rewritten = rewriteDynamicNodeImports(source);

  if (rewritten !== source) {
    writeFileSync(bundlePath, rewritten);
    console.log(`Rewrote dynamic node: imports in ${path.basename(bundlePath)}`);
  }
}
