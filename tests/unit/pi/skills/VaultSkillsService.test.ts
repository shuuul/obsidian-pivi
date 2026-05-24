import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import type { Skill } from '@earendil-works/pi-coding-agent';

import * as loadContextLayers from '../../../../src/pi/context/loadContextLayers';
import { normalizeSkillSlug, VaultSkillsService } from '../../../../src/pi/skills/VaultSkillsService';

describe('normalizeSkillSlug', () => {
  it('accepts owner/repo', () => {
    expect(normalizeSkillSlug('vercel-labs/agent-skills')).toBe('vercel-labs/agent-skills');
  });

  it('parses GitHub URLs', () => {
    expect(normalizeSkillSlug('https://github.com/foo/bar.git')).toBe('foo/bar');
  });

  it('parses skills.sh URLs', () => {
    expect(normalizeSkillSlug('https://skills.sh/vercel-labs/agent-skills')).toBe(
      'vercel-labs/agent-skills',
    );
  });

  it('rejects invalid slugs', () => {
    expect(() => normalizeSkillSlug('not-a-slug')).toThrow(/owner\/repo/);
  });
});

describe('VaultSkillsService sync', () => {
  let vaultPath: string;

  beforeEach(() => {
    vaultPath = fs.mkdtempSync(path.join(os.tmpdir(), 'obsius-skills-'));
    fs.mkdirSync(path.join(vaultPath, '.obsius', 'skills'), { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(vaultPath, { recursive: true, force: true });
  });

  it('lists skills from loadVaultSkills', () => {
    const skillMd = path.join(vaultPath, '.obsius', 'skills', 'demo-skill', 'SKILL.md');
    const mockSkill = {
      name: 'demo',
      description: 'Demo skill',
      filePath: skillMd,
      baseDir: path.dirname(skillMd),
      sourceInfo: {
        source: 'obsius-vault',
        path: skillMd,
        scope: 'project',
        origin: 'package',
      },
      disableModelInvocation: false,
    } as Skill;

    jest.spyOn(loadContextLayers, 'loadVaultSkills').mockReturnValue({
      skills: [mockSkill],
      skillsXml: '<skills/>',
    });

    const service = new VaultSkillsService(vaultPath);
    const listed = service.list();
    expect(listed).toHaveLength(1);
    expect(listed[0]?.name).toBe('demo');
    expect(listed[0]?.folderName).toBe('demo-skill');
  });

  it('removes a skill folder', () => {
    const skillDir = path.join(vaultPath, '.obsius', 'skills', 'to-remove');
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(path.join(skillDir, 'SKILL.md'), '---\nname: x\ndescription: y\n---\n', 'utf-8');

    const service = new VaultSkillsService(vaultPath);
    service.remove('to-remove');
    expect(fs.existsSync(skillDir)).toBe(false);
  });
});
