import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import type { Skill } from '@pivi/agent/skills/vault/loadVaultSkills';
import { createSkillTool } from '@pivi/engine-pi/createSkillTool';

function textOf(result: { content: Array<{ type: string; text?: string }> }): string {
  const firstContent = result.content[0];
  if (!firstContent || firstContent.type !== 'text' || typeof firstContent.text !== 'string') {
    throw new Error('Expected the skill result to contain text');
  }
  return firstContent.text;
}

describe('createSkillTool', () => {
  const skillDir = '.pivi/skills/demo-skill';
  const skillFilePath = `${skillDir}/SKILL.md`;
  const absoluteBaseDir = '/vault/.pivi/skills/demo-skill';
  const absoluteFilePath = `${absoluteBaseDir}/SKILL.md`;
  const skills: Skill[] = [
    {
      name: 'demo-skill',
      description: 'Demo',
      filePath: skillFilePath,
      baseDir: skillDir,
      absoluteFilePath,
      absoluteBaseDir,
      content: `---
name: demo-skill
description: Demo
---
# Do the thing

Follow these steps.`,
    },
    {
      name: 'other-skill',
      description: 'Other',
      filePath: '.pivi/skills/other/SKILL.md',
      baseDir: '.pivi/skills/other',
      absoluteFilePath: '/vault/.pivi/skills/other/SKILL.md',
      absoluteBaseDir: '/vault/.pivi/skills/other',
      content: '# Other skill',
    },
  ];

  it('loads skill body without YAML frontmatter and returns text details', async () => {
    const tool = createSkillTool(skills);
    const result = await tool.execute('call-1', { name: 'demo-skill' });
    const text = textOf(result);

    expect(text).toContain(`<skill name="demo-skill" location="${absoluteFilePath}">`);
    expect(text).toContain('Do not join relative names onto that directory.');
    expect(text).toContain(`Skill directory: ${absoluteBaseDir}`);
    expect(text).toContain('# Do the thing');
    expect(text).toContain('Follow these steps.');
    expect(text).toContain('</skill>');
    expect(text).not.toContain('name: demo-skill');
    expect(result.details).toEqual({ baseDir: skillDir, filePath: skillFilePath, description: 'Demo' });
  });

  it('appends trimmed optional args after the skill block', async () => {
    const tool = createSkillTool(skills);
    const result = await tool.execute('call-2', { name: 'demo-skill', args: '  focus on edge cases  ' });
    const text = textOf(result);
    expect(text).toContain('</skill>');
    expect(text.endsWith('focus on edge cases')).toBe(true);
    expect(text).toContain('# Do the thing');
    expect(text).not.toContain('name: demo-skill');
  });

  it('throws listing available skill names when name is unknown', async () => {
    const tool = createSkillTool(skills);

    await expect(
      (async () => {
        await tool.execute('call-3', { name: 'missing-skill' });
      })(),
    ).rejects.toThrow('Unknown skill "missing-skill". Available: demo-skill, other-skill');
  });

  it('reports (none installed) when skills list is empty', async () => {
    const tool = createSkillTool([]);

    await expect(
      (async () => {
        await tool.execute('call-4', { name: 'any' });
      })(),
    ).rejects.toThrow('Unknown skill "any". Available: (none installed)');
  });

  it('expands existing supporting files and refuses to join missing relative names', async () => {
    const installedDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pivi-skill-tool-'));
    try {
      fs.writeFileSync(path.join(installedDir, 'SKILL.md'), '# Skill\n');
      fs.mkdirSync(path.join(installedDir, 'references'));
      const syntaxPath = path.join(installedDir, 'references', 'syntax.md');
      fs.writeFileSync(syntaxPath, '# Syntax\n');
      const tool = createSkillTool([
        {
          name: 'obsidian-marp',
          description: 'Marp',
          filePath: '.pivi/skills/obsidian-marp/SKILL.md',
          baseDir: '.pivi/skills/obsidian-marp',
          absoluteFilePath: path.join(installedDir, 'SKILL.md'),
          absoluteBaseDir: installedDir,
          content: `---
name: obsidian-marp
---
Read \`docs/marp-extended-syntax.md\` then \`references/syntax.md\`.
`,
        },
      ]);

      const text = textOf(await tool.execute('call-5', { name: 'obsidian-marp' }));
      expect(text).toContain(`\`${syntaxPath}\``);
      expect(text).toContain('docs/marp-extended-syntax.md (not in this skill; do not read)');
      expect(text).not.toContain('`docs/marp-extended-syntax.md`');
      expect(text).toContain('Not present in this skill (do not read):');
      expect(text).toContain('- docs/marp-extended-syntax.md');
    } finally {
      fs.rmSync(installedDir, { recursive: true, force: true });
    }
  });
});
