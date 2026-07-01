import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { findNpxExecutable, getSpawnEnvWithEnhancedPath } from '../../../../src/pi/settings/env';

describe('findNpxExecutable', () => {
  let tempBinDir: string;
  const originalPath = process.env.PATH;

  beforeEach(() => {
    tempBinDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pivi-npx-'));
    const nodePath = path.join(tempBinDir, process.platform === 'win32' ? 'node.exe' : 'node');
    const npxPath = path.join(tempBinDir, process.platform === 'win32' ? 'npx.cmd' : 'npx');
    fs.writeFileSync(nodePath, '', 'utf-8');
    fs.writeFileSync(npxPath, '', 'utf-8');
    process.env.PATH = tempBinDir;
  });

  afterEach(() => {
    process.env.PATH = originalPath;
    fs.rmSync(tempBinDir, { recursive: true, force: true });
  });

  it('finds npx next to node when only the given bin dir is searched first', () => {
    process.env.PATH = '';
    const npx = findNpxExecutable(tempBinDir);
    expect(npx).not.toBeNull();
    expect(npx).toContain(process.platform === 'win32' ? 'npx.cmd' : 'npx');
    expect(path.dirname(npx!)).toBe(tempBinDir);
  });

  it('getSpawnEnvWithEnhancedPath prepends common binary dirs', () => {
    process.env.PATH = '';
    const env = getSpawnEnvWithEnhancedPath();
    expect(env.PATH).toContain('/opt/homebrew/bin');
    expect(env.PATH).toContain('/usr/local/bin');
  });
});
