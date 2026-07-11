import type { Skill } from '@pivi/pivi-agent-core/skills/vault/loadVaultSkills';
import { createSkillTool } from '@pivi/pivi-agent-core/engine/pi/createSkillTool';

describe('createSkillTool', () => {
  const skillDir = '/vault/.pivi/skills/demo-skill';
  const skillFilePath = `${skillDir}/SKILL.md`;
  const skills: Skill[] = [
    {
      name: 'demo-skill',
      description: 'Demo',
      filePath: skillFilePath,
      baseDir: skillDir,
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
      filePath: '/vault/.pivi/skills/other/SKILL.md',
      baseDir: '/vault/.pivi/skills/other',
      content: '# Other skill',
    },
  ];

  it('loads skill body without YAML frontmatter and returns text details', async () => {
    const tool = createSkillTool(skills);
    const result = await tool.execute('call-1', { name: 'demo-skill' });

    expect(result.content).toEqual([
      {
        type: 'text',
        text: `<skill name="demo-skill" location="${skillFilePath}">
References are relative to ${skillDir}.

# Do the thing

Follow these steps.
</skill>`,
      },
    ]);
    expect(result.details).toEqual({ baseDir: skillDir, filePath: skillFilePath, description: 'Demo' });
  });

  it('appends trimmed optional args after the skill block', async () => {
    const tool = createSkillTool(skills);
    const result = await tool.execute('call-2', { name: 'demo-skill', args: '  focus on edge cases  ' });

    const firstContent = result.content[0];
    expect(firstContent).toBeDefined();
    if (!firstContent || firstContent.type !== 'text') {
      throw new Error('Expected the skill result to contain text');
    }
    const text = firstContent.text;
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
});