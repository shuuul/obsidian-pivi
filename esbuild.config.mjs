import esbuild from 'esbuild';
import { existsSync, readFileSync } from 'fs';
import process from 'process';
import { createBuildOptions } from './build/create-build-options.mjs';
import { createCopyToObsidianPlugin } from './build/plugins/copy-to-obsidian.mjs';

// Load .env.local if it exists.
if (existsSync('.env.local')) {
  const envContent = readFileSync('.env.local', 'utf-8');
  for (const line of envContent.split('\n')) {
    const match = line.match(/^([^=]+)=["']?(.+?)["']?$/);
    if (match && !process.env[match[1]]) {
      process.env[match[1]] = match[2];
    }
  }
}

const production = process.argv[2] === 'production';
const buildOptions = createBuildOptions({ production });
buildOptions.plugins.push(createCopyToObsidianPlugin());

const context = await esbuild.context(buildOptions);

if (production) {
  await context.rebuild();
  process.exit(0);
}

await context.watch();
