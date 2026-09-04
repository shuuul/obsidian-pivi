#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { embeddedSkillsCliGzipBytes } from '../build/create-build-options.mjs';

export const SOFT_GROWTH_BYTES = 100 * 1024;
export const SOFT_GROWTH_RATIO = 0.02;

function outputFor(metafile) {
  const outputs = Object.entries(metafile.outputs ?? {});
  if (outputs.length !== 1) {
    throw new Error(`Expected one bundle output, found ${outputs.length}.`);
  }
  return outputs[0][1];
}

function signedBytes(bytes) {
  return `${bytes >= 0 ? '+' : '−'}${Math.abs(bytes).toLocaleString('en-US')} B`;
}

export function createBundleReport({ baseMetafile, currentMetafile, skillsCliGzipBytes }) {
  const base = outputFor(baseMetafile);
  const current = outputFor(currentMetafile);
  const delta = current.bytes - base.bytes;
  const ratio = base.bytes === 0 ? 0 : delta / base.bytes;
  const warning = delta > SOFT_GROWTH_BYTES || ratio > SOFT_GROWTH_RATIO;
  const baseInputs = base.inputs ?? {};
  const largestInputs = Object.entries(current.inputs ?? {})
    .map(([input, contribution]) => ({
      input,
      bytes: contribution.bytesInOutput,
      delta: contribution.bytesInOutput - (baseInputs[input]?.bytesInOutput ?? 0),
    }))
    .sort((left, right) => right.bytes - left.bytes)
    .slice(0, 20);

  const lines = [
    '## Bundle report',
    '',
    `- **Current:** ${current.bytes.toLocaleString('en-US')} B`,
    `- **Base:** ${base.bytes.toLocaleString('en-US')} B`,
    `- **Delta:** ${signedBytes(delta)} (${ratio >= 0 ? '+' : ''}${(ratio * 100).toFixed(2)}%)`,
    `- **Embedded Skills CLI (gzip):** ${skillsCliGzipBytes.toLocaleString('en-US')} B`,
  ];

  if (warning) {
    lines.push('', `> [!WARNING] Bundle growth exceeds the soft review threshold of 100 KiB or 2%. The 5 MiB hard gate is unchanged.`);
  }

  lines.push('', '### Largest inputs', '', '| Input | Current | Delta |', '| --- | ---: | ---: |');
  for (const input of largestInputs) {
    lines.push(`| \`${input.input.replaceAll('|', '\\|')}\` | ${input.bytes.toLocaleString('en-US')} B | ${signedBytes(input.delta)} |`);
  }
  lines.push('');

  return { markdown: lines.join('\n'), warning, delta, ratio, largestInputs };
}

function argument(name) {
  const index = process.argv.indexOf(name);
  if (index < 0 || !process.argv[index + 1]) {
    throw new Error(`${name} requires a file path.`);
  }
  return process.argv[index + 1];
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const baseMetafile = JSON.parse(readFileSync(argument('--base'), 'utf8'));
  const currentMetafile = JSON.parse(readFileSync(argument('--current'), 'utf8'));
  const report = createBundleReport({
    baseMetafile,
    currentMetafile,
    skillsCliGzipBytes: embeddedSkillsCliGzipBytes,
  });
  process.stdout.write(report.markdown);
}
