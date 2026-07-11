import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  rmSync,
} from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { rewriteDynamicNodeImportsFile } from '../postprocess/rewrite-node-imports.mjs';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const obsidianPluginDeployFiles = new Set(['main.js', 'manifest.json', 'styles.css']);

function pruneStaleObsidianPluginArtifacts(pluginPath) {
  const keep = new Set([...obsidianPluginDeployFiles, 'data.json']);
  for (const name of readdirSync(pluginPath)) {
    if (keep.has(name)) {
      continue;
    }
    rmSync(path.join(pluginPath, name), { recursive: true, force: true });
    console.log(`Removed stale Obsidian plugin artifact: ${name}`);
  }
}

/**
 * Postprocesses a successful bundle and deploys the plugin artifacts to a configured vault.
 * A missing or invalid vault path deliberately disables deployment, matching the build contract.
 */
export function createCopyToObsidianPlugin({
  obsidianVault = process.env.OBSIDIAN_VAULT,
  bundlePath = path.join(rootDir, 'main.js'),
} = {}) {
  const pluginPath = obsidianVault && existsSync(obsidianVault)
    ? path.join(obsidianVault, '.obsidian', 'plugins', 'pivi')
    : null;

  return {
    name: 'copy-to-obsidian',
    setup(build) {
      build.onEnd((result) => {
        if (result.errors.length > 0) {
          return;
        }

        rewriteDynamicNodeImportsFile(bundlePath);

        if (!pluginPath) {
          return;
        }

        if (!existsSync(pluginPath)) {
          mkdirSync(pluginPath, { recursive: true });
        }

        pruneStaleObsidianPluginArtifacts(pluginPath);

        for (const file of obsidianPluginDeployFiles) {
          const source = path.join(rootDir, file);
          if (existsSync(source)) {
            copyFileSync(source, path.join(pluginPath, file));
            console.log(`Copied ${file} to Obsidian plugin folder`);
          }
        }
      });
    },
  };
}
