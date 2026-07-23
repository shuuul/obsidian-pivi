import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import {
  matchBashAllowlist,
  parseBashAllowlistEntry,
  resolveExecutablePath,
  tokenizeArgv,
} from '@pivi/obsidian-tools';

describe('bashAllowlist structured matching', () => {
  let binDir: string;
  let gitPath: string;
  let npmPath: string;

  beforeEach(() => {
    binDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pivi-bash-bin-'));
    gitPath = path.join(binDir, 'git');
    npmPath = path.join(binDir, 'npm');
    fs.writeFileSync(gitPath, '#!/bin/sh\n');
    fs.writeFileSync(npmPath, '#!/bin/sh\n');
    fs.chmodSync(gitPath, 0o755);
    fs.chmodSync(npmPath, 0o755);
  });

  afterEach(() => {
    fs.rmSync(binDir, { recursive: true, force: true });
  });

  it('parses bare executables and argument schemas', () => {
    expect(parseBashAllowlistEntry('git')).toEqual({ executable: 'git', argsPrefix: [] });
    expect(parseBashAllowlistEntry('npm run build')).toEqual({
      executable: 'npm',
      argsPrefix: ['run', 'build'],
    });
  });

  it('tokenizes quoted argv literally', () => {
    expect(tokenizeArgv(`echo "a b" 'c d'`)).toEqual(['echo', 'a b', 'c d']);
  });

  it('matches canonical executable paths rather than string prefixes', () => {
    const env = { ...process.env, PATH: binDir };
    const matched = matchBashAllowlist(['git', 'status'], ['git'], env);
    // The resolver uses realpathSync.native, which keeps 8.3 short names on
    // Windows; compare through realpathSync so both sides canonicalize alike.
    expect(fs.realpathSync(matched!.executablePath)).toBe(fs.realpathSync(gitPath));
    expect(matched?.args).toEqual(['status']);
  });

  it('requires argument schemas for multi-token allowlist entries', () => {
    const env = { ...process.env, PATH: binDir };
    expect(matchBashAllowlist(['npm', 'run', 'build', '--silent'], ['npm run build'], env)?.args)
      .toEqual(['run', 'build', '--silent']);
    expect(matchBashAllowlist(['npm', 'install'], ['npm run build'], env)).toBeNull();
  });

  it('does not treat string prefixes of the command line as authority', () => {
    const env = { ...process.env, PATH: binDir };
    expect(matchBashAllowlist(['npm', 'run', 'build:evil'], ['npm run build'], env)).toBeNull();
  });

  it('resolves absolute executables', () => {
    expect(fs.realpathSync(resolveExecutablePath(gitPath)!)).toBe(fs.realpathSync(gitPath));
  });
});
