const { spawnSync } = require('child_process');
const os = require('os');
const path = require('path');

const jestPath = require.resolve('jest/bin/jest');

/** --localstorage-file exists from Node 22.4; required on Node 26+ when code touches localStorage. */
function nodeSupportsLocalStorageFile() {
  const [major, minor] = process.versions.node.split('.').map(Number);
  return major > 22 || (major === 22 && minor >= 4);
}

const nodeArgs = [];
if (nodeSupportsLocalStorageFile()) {
  const localStorageFile = path.join(os.tmpdir(), 'obsius2-localstorage');
  nodeArgs.push(`--localstorage-file=${localStorageFile}`);
}

const result = spawnSync(
  process.execPath,
  [...nodeArgs, jestPath, ...process.argv.slice(2)],
  { stdio: 'inherit' }
);

if (result.error) {
  console.error(result.error);
  process.exit(1);
}

process.exit(result.status ?? 1);
