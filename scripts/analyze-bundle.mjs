#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { rolldown } from 'rolldown';
import { createBuildOptions } from '../build/create-build-options.mjs';

function option(name) {
  const index = process.argv.indexOf(name);
  if (index === -1) return undefined;
  const value = process.argv[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`${name} requires a value.`);
  return value;
}

const outputPath = path.resolve(option('--output') ?? 'metafile.json');
const project = option('--project');
if (project && path.resolve(project) !== process.cwd()) {
  // Run the analysis script in the requested revision so it uses its own bundler.
  execFileSync(process.execPath, ['scripts/analyze-bundle.mjs', '--output', outputPath], {
    cwd: path.resolve(project),
    stdio: 'inherit',
  });
} else {
  await analyzeBundle(outputPath);
}

async function analyzeBundle(destination) {
  const options = await createBuildOptions({ production: true });
  const bundle = await rolldown(options.input);
  try {
    const { output } = await bundle.generate(options.output);
    if (output.length !== 1 || output[0].type !== 'chunk') {
      throw new Error('Expected a single plugin bundle.');
    }
    const chunk = output[0];
    const inputs = Object.fromEntries(
      Object.entries(chunk.modules).map(([id, module]) => [
        id.startsWith('\0')
          ? id.slice(1)
          : path.relative(options.input.cwd, id).replaceAll('\\', '/'),
        { bytesInOutput: Buffer.byteLength(module.code ?? '', 'utf8') },
      ]),
    );
    const metadata = {
      moduleSizes: 'rendered-before-minification',
      outputs: { [chunk.fileName]: { bytes: Buffer.byteLength(chunk.code), inputs } },
      skillsCliGzipBytes: options.skillsCliGzipBytes,
    };
    writeFileSync(destination, JSON.stringify(metadata));
    console.log(`Wrote ${destination}`);
  } finally {
    await bundle.close();
  }
}
