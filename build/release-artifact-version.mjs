import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const buildDir = path.dirname(fileURLToPath(import.meta.url));
const packageJson = JSON.parse(
  readFileSync(path.resolve(buildDir, '..', 'package.json'), 'utf8'),
);

if (typeof packageJson.version !== 'string' || packageJson.version.length === 0) {
  throw new Error('package.json must contain a non-empty version for release artifacts');
}

export const releaseArtifactVersion = packageJson.version;
export const releaseArtifactBanner = `/* Pivi ${releaseArtifactVersion} */`;
