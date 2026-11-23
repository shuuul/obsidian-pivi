import { rolldown, watch } from 'rolldown';
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
const { input, output } = await createBuildOptions({ production });
input.plugins.push(createCopyToObsidianPlugin());

if (production) {
  const bundle = await rolldown(input);
  try {
    await bundle.write(output);
  } finally {
    await bundle.close();
  }
} else {
  const watcher = watch({ ...input, output });
  watcher.on('event', async (event) => {
    if (event.code === 'ERROR') console.error(event.error);
    if (event.code === 'BUNDLE_END') {
      await event.result?.close();
      console.log(`Built main.js in ${event.duration} ms`);
    }
  });
}
