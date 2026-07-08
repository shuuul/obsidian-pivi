import {
  loadAgentsMdChain,
  loadContextLayers,
} from '@pivi/pivi-agent-core/context/loadContextLayers';
import {
  loadRuntimeVaultSkills,
  loadVaultSkills,
} from '@pivi/pivi-agent-core/skills/vault/loadVaultSkills';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

function seedSkill(vaultPath: string, slug: string, name: string, description: string): void {
  const skillDir = path.join(vaultPath, '.pivi', 'skills', slug);
  fs.mkdirSync(skillDir, { recursive: true });
  fs.writeFileSync(
    path.join(skillDir, 'SKILL.md'),
    `---
name: ${name}
description: ${description}
---
Body`,
    'utf-8',
  );
}

describe('loadAgentsMdChain', () => {
  let vaultPath: string;

  beforeEach(() => {
    vaultPath = fs.mkdtempSync(path.join(os.tmpdir(), 'pivi-context-'));
  });

  afterEach(() => {
    fs.rmSync(vaultPath, { recursive: true, force: true });
  });

  it('returns empty string when vault has no AGENTS.md files', () => {
    expect(loadAgentsMdChain(vaultPath)).toBe('');
    expect(loadAgentsMdChain(vaultPath, null)).toBe('');
    expect(loadAgentsMdChain(vaultPath, 'notes/draft.md')).toBe('');
  });

  it('loads root AGENTS.md when active note is omitted', () => {
    fs.writeFileSync(path.join(vaultPath, 'AGENTS.md'), 'Root agent rules.', 'utf-8');

    expect(loadAgentsMdChain(vaultPath)).toBe('Root agent rules.');
    expect(loadAgentsMdChain(vaultPath, undefined)).toBe('Root agent rules.');
  });

  it('chains AGENTS.md from vault root to active note directory with separator', () => {
    fs.mkdirSync(path.join(vaultPath, 'projects', 'alpha'), { recursive: true });
    fs.writeFileSync(path.join(vaultPath, 'AGENTS.md'), 'Vault-wide agents.', 'utf-8');
    fs.writeFileSync(
      path.join(vaultPath, 'projects', 'AGENTS.md'),
      'Project scope agents.',
      'utf-8',
    );
    fs.writeFileSync(
      path.join(vaultPath, 'projects', 'alpha', 'AGENTS.md'),
      'Alpha team agents.',
      'utf-8',
    );
    fs.writeFileSync(path.join(vaultPath, 'projects', 'alpha', 'note.md'), '# Note', 'utf-8');

    const chain = loadAgentsMdChain(vaultPath, 'projects/alpha/note.md');

    expect(chain).toBe(
      'Vault-wide agents.\n\n---\n\nProject scope agents.\n\n---\n\nAlpha team agents.',
    );
    expect(chain.indexOf('Vault-wide agents.')).toBeLessThan(chain.indexOf('Alpha team agents.'));
    expect(chain).toContain('\n\n---\n\n');
  });

  it('does not walk outside the vault when active note path escapes the vault root', () => {
    const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pivi-outside-'));
    try {
      fs.writeFileSync(path.join(vaultPath, 'AGENTS.md'), 'Inside vault only.', 'utf-8');
      fs.writeFileSync(path.join(outsideDir, 'AGENTS.md'), 'Outside vault must not load.', 'utf-8');

      const escaped = path.relative(vaultPath, path.join(outsideDir, 'note.md'));
      const chain = loadAgentsMdChain(vaultPath, escaped);

      expect(chain).toBe('Inside vault only.');
      expect(chain).not.toContain('Outside vault must not load.');
    } finally {
      fs.rmSync(outsideDir, { recursive: true, force: true });
    }
  });

  it('does not treat sibling paths with the vault prefix as inside the vault', () => {
    const siblingVaultPrefixDir = `${vaultPath}-sibling`;
    try {
      fs.mkdirSync(siblingVaultPrefixDir, { recursive: true });
      fs.writeFileSync(path.join(vaultPath, 'AGENTS.md'), 'Inside vault only.', 'utf-8');
      fs.writeFileSync(
        path.join(siblingVaultPrefixDir, 'AGENTS.md'),
        'Sibling prefix must not load.',
        'utf-8',
      );

      const escaped = path.relative(vaultPath, path.join(siblingVaultPrefixDir, 'note.md'));
      const chain = loadAgentsMdChain(vaultPath, escaped);

      expect(chain).toBe('Inside vault only.');
      expect(chain).not.toContain('Sibling prefix must not load.');
    } finally {
      fs.rmSync(siblingVaultPrefixDir, { recursive: true, force: true });
    }
  });
});

describe('loadContextLayers', () => {
  let vaultPath: string;

  beforeEach(() => {
    vaultPath = fs.mkdtempSync(path.join(os.tmpdir(), 'pivi-layers-'));
  });

  afterEach(() => {
    fs.rmSync(vaultPath, { recursive: true, force: true });
  });

  it('returns empty agents, system, and skills for an empty vault', () => {
    const layers = loadContextLayers(vaultPath);

    expect(layers.agentsMd).toBe('');
    expect(layers.systemMd).toBe('');
    expect(layers.skillsXml).toBe('');
    expect(layers.skills).toEqual([]);
  });

  it('includes root AGENTS.md without an active note path', () => {
    fs.writeFileSync(path.join(vaultPath, 'AGENTS.md'), 'Always cite sources.', 'utf-8');

    const layers = loadContextLayers(vaultPath);

    expect(layers.agentsMd).toBe('Always cite sources.');
    expect(layers.systemMd).toBe('');
    expect(layers.skillsXml).toBe('');
    expect(layers.skills).toEqual([]);
  });

  it('aggregates nested AGENTS.md for the active note', () => {
    fs.mkdirSync(path.join(vaultPath, 'area'), { recursive: true });
    fs.writeFileSync(path.join(vaultPath, 'AGENTS.md'), 'Root', 'utf-8');
    fs.writeFileSync(path.join(vaultPath, 'area', 'AGENTS.md'), 'Area', 'utf-8');
    fs.writeFileSync(path.join(vaultPath, 'area', 'doc.md'), 'x', 'utf-8');

    const layers = loadContextLayers(vaultPath, 'area/doc.md');

    expect(layers.agentsMd).toBe('Root\n\n---\n\nArea');
  });

  it('returns empty systemMd when SYSTEM.md is missing', () => {
    fs.writeFileSync(path.join(vaultPath, 'AGENTS.md'), 'agents', 'utf-8');

    const layers = loadContextLayers(vaultPath);

    expect(layers.systemMd).toBe('');
  });

  it('includes SYSTEM.md and vault skill XML when present', () => {
    fs.writeFileSync(path.join(vaultPath, 'AGENTS.md'), 'agents', 'utf-8');
    fs.mkdirSync(path.join(vaultPath, '.pivi'), { recursive: true });
    fs.writeFileSync(path.join(vaultPath, '.pivi', 'SYSTEM.md'), 'Vault system rules.', 'utf-8');
    seedSkill(vaultPath, 'demo-skill', 'demo-skill', 'A demo skill');

    const layers = loadContextLayers(vaultPath);

    expect(layers.systemMd).toBe('Vault system rules.');
    expect(layers.skills).toHaveLength(1);
    expect(layers.skills[0]?.name).toBe('demo-skill');
    expect(layers.skillsXml).toContain('<available_skills>');
    expect(layers.skillsXml).toContain('name="demo-skill"');
    expect(layers.skillsXml).toContain('description="A demo skill"');
  });

  it('excludes disabled vault skills from runtime context', () => {
    seedSkill(vaultPath, 'enabled-skill', 'enabled-skill', 'Enabled skill');
    seedSkill(vaultPath, 'disabled-skill', 'disabled-skill', 'Disabled skill');
    fs.writeFileSync(path.join(vaultPath, '.pivi', 'skills', 'disabled-skill', '.disabled'), 'disabled\n', 'utf-8');

    const layers = loadContextLayers(vaultPath);
    const runtime = loadRuntimeVaultSkills(vaultPath);

    expect(layers.skills.map((skill) => skill.name)).toEqual(['enabled-skill']);
    expect(layers.skillsXml).toContain('enabled-skill');
    expect(layers.skillsXml).not.toContain('disabled-skill');
    expect(runtime.skills.map((skill) => skill.name)).toEqual(['enabled-skill']);
    expect(runtime.skillsXml).not.toContain('disabled-skill');
  });

  it('includes disabled vault skills in the inventory load', () => {
    seedSkill(vaultPath, 'enabled-skill', 'enabled-skill', 'Enabled skill');
    seedSkill(vaultPath, 'disabled-skill', 'disabled-skill', 'Disabled skill');
    fs.writeFileSync(path.join(vaultPath, '.pivi', 'skills', 'disabled-skill', '.disabled'), 'disabled\n', 'utf-8');

    const inventory = loadVaultSkills(vaultPath);

    expect(inventory.skills.map((skill) => skill.name)).toEqual(['disabled-skill', 'enabled-skill']);
    expect(inventory.skills.find((skill) => skill.name === 'disabled-skill')?.disabled).toBe(true);
    expect(inventory.skills.find((skill) => skill.name === 'enabled-skill')?.disabled).toBe(false);
    expect(inventory.skillsXml).toContain('disabled-skill');
    expect(inventory.skillsXml).toContain('enabled-skill');
  });

  it('ignores AGENTS.md outside the vault for escaped active note paths', () => {
    const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pivi-layers-out-'));
    try {
      fs.writeFileSync(path.join(vaultPath, 'AGENTS.md'), 'Vault agents', 'utf-8');
      fs.writeFileSync(path.join(outsideDir, 'AGENTS.md'), 'External agents', 'utf-8');

      const escaped = path.relative(vaultPath, path.join(outsideDir, 'x.md'));
      const layers = loadContextLayers(vaultPath, escaped);

      expect(layers.agentsMd).toBe('Vault agents');
      expect(layers.agentsMd).not.toContain('External agents');
    } finally {
      fs.rmSync(outsideDir, { recursive: true, force: true });
    }
  });
});
