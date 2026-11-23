import { RolldownMagicString } from 'rolldown';
import { parseSync, Visitor } from 'rolldown/utils';

const piAuthLoaderSpecifiers = new Set(['node:fs/promises', 'node:os']);

function literalString(node) {
  return node?.type === 'Literal' && typeof node.value === 'string' ? node.value : undefined;
}

/** Electron's renderer loads these builtins through CommonJS require. */
export function rewriteDynamicNodeImports(source, fileName = 'main.js') {
  const { program, errors } = parseSync(fileName, source);
  if (errors.length) throw new Error(`Could not parse ${fileName}: ${errors[0].message}`);

  const code = new RolldownMagicString(source);
  let changed = false;
  function replace(node, replacement) {
    changed = true;
    code.overwrite(node.start, node.end, replacement);
  }

  new Visitor({
    ImportExpression(node) {
      const specifier = literalString(node.source);
      if (specifier === 'crypto' || specifier?.startsWith('node:')) {
        replace(
          node,
          `Promise.resolve(require(${JSON.stringify(specifier.replace(/^node:/, ''))}))`,
        );
      } else if (
        node.source.type === 'CallExpression' &&
        node.source.arguments.some((arg) => literalString(arg)?.startsWith('node:'))
      ) {
        throw new Error('Build output still contains a computed node: import.');
      }
    },
    CallExpression(node) {
      if (node.callee.type !== 'Identifier' || node.arguments.length !== 1) return;
      const argument = node.arguments[0];
      const specifier = literalString(argument);
      if (!specifier?.startsWith('node:')) return;
      if (node.callee.name === 'require') {
        replace(argument, JSON.stringify(specifier.slice(5)));
      } else if (
        /^importNodeModule\d*$/.test(node.callee.name) &&
        piAuthLoaderSpecifiers.has(specifier)
      ) {
        // pi-ai auth/context uses a shared import helper for these builtins.
        replace(node, `Promise.resolve(require(${JSON.stringify(specifier.slice(5))}))`);
      }
    },
  }).visit(program);

  return changed ? { code: code.toString(), map: code.generateMap({ hires: 'boundary' }) } : null;
}
