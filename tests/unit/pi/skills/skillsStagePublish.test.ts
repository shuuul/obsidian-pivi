import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import {
  publishValidatedSkillTree,
  SkillStageValidationError,
  validateStagedSkillTree,
} from '@pivi/pivi-agent-core/skills/vault/skillStagePublish';
import { resolvePinnedSkillsCli } from '@pivi/pivi-agent-core/skills/vault/resolvePinnedSkillsCli';
import { PINNED_SKILLS_CLI_VERSION } from '@pivi/pivi-agent-core/skills/vault/skillsCliConstants';

describe('skills staged publish', () => {
  it('rejects symlinks and publishes atomically only after validation', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pivi-skill-stage-'));
    try {
      const staged = path.join(root, 'staged');
      const dest = path.join(root, 'skills');
      fs.mkdirSync(staged, { recursive: true });
      fs.writeFileSync(path.join(staged, 'SKILL.md'), '---\nname: demo\n---\nbody\n');
      fs.symlinkSync('/tmp', path.join(staged, 'link'));
      expect(() => validateStagedSkillTree(staged)).toThrow(SkillStageValidationError);

      fs.rmSync(path.join(staged, 'link'), { force: true });
      const previous = path.join(dest, 'demo');
      fs.mkdirSync(previous, { recursive: true });
      fs.writeFileSync(path.join(previous, 'SKILL.md'), 'old\n');
      const before = fs.readFileSync(path.join(previous, 'SKILL.md'), 'utf8');

      const badStage = path.join(root, 'bad');
      fs.mkdirSync(badStage, { recursive: true });
      // Missing SKILL.md
      fs.writeFileSync(path.join(badStage, 'other.md'), 'x');
      expect(() => publishValidatedSkillTree({
        stagedDir: badStage,
        destinationDir: dest,
        folderName: 'demo',
      })).toThrow(SkillStageValidationError);
      expect(fs.readFileSync(path.join(previous, 'SKILL.md'), 'utf8')).toBe(before);

      publishValidatedSkillTree({
        stagedDir: staged,
        destinationDir: dest,
        folderName: 'demo',
      });
      expect(fs.readFileSync(path.join(dest, 'demo', 'SKILL.md'), 'utf8')).toContain('name: demo');
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('pinned skills CLI', () => {
  it('resolves the exact lockfile skills package without npx', () => {
    const cli = resolvePinnedSkillsCli();
    expect(cli.version).toBe(PINNED_SKILLS_CLI_VERSION);
    expect(cli.cliPath).toContain(`${path.sep}skills${path.sep}`);
    expect(cli.cliPath.endsWith(`${path.sep}bin${path.sep}cli.mjs`)).toBe(true);
    expect(cli.executable.toLowerCase()).toContain('node');
  });

  it('never resolves executable code from the vault vendor directory', () => {
    const vaultPath = fs.mkdtempSync(path.join(os.tmpdir(), 'pivi-vault-skills-cli-'));
    const untrustedRoot = path.join(
      vaultPath,
      '.pivi',
      'vendor',
      'skills',
      PINNED_SKILLS_CLI_VERSION,
    );
    try {
      fs.mkdirSync(path.join(untrustedRoot, 'bin'), { recursive: true });
      fs.writeFileSync(path.join(untrustedRoot, 'package.json'), JSON.stringify({
        name: 'skills',
        version: PINNED_SKILLS_CLI_VERSION,
      }));
      fs.writeFileSync(path.join(untrustedRoot, 'bin', 'cli.mjs'), 'throw new Error("executed")');

      const cli = resolvePinnedSkillsCli({ vaultPath });

      expect(cli.cliPath.startsWith(vaultPath)).toBe(false);
    } finally {
      fs.rmSync(vaultPath, { recursive: true, force: true });
    }
  });
});
