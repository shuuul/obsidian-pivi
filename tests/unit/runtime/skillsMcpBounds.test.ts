import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import {
  materializeMcpToolResult,
  McpResultBudgetError,
} from '@pivi/pivi-agent-core/mcp/mcpResultBudget';
import {
  buildMcpArtifactVaultPath,
  formatMcpArtifactReference,
  MCP_ARTIFACT_MAX_BYTES,
  serializeBoundedMcpArtifact,
} from '@pivi/pivi-agent-core/mcp/mcpArtifactFallback';
import {
  publishValidatedSkillTree,
  SkillStageValidationError,
  validateStagedSkillTree,
} from '@pivi/pivi-agent-core/skills/vault/skillStagePublish';
import { resolvePinnedSkillsCli } from '@pivi/pivi-agent-core/skills/vault/resolvePinnedSkillsCli';
import { PINNED_SKILLS_CLI_VERSION } from '@pivi/pivi-agent-core/runtime/highRisk';

describe('mcp result budgets', () => {
  it('rejects oversized block counts and deep JSON before materialization completes', () => {
    expect(() => materializeMcpToolResult(
      Array.from({ length: 40 }, () => ({ type: 'text', text: 'x' })),
    )).toThrow(McpResultBudgetError);

    let deep: unknown = 1;
    for (let i = 0; i < 20; i += 1) {
      deep = { nested: deep };
    }
    expect(() => materializeMcpToolResult([
      { type: 'resource', resource: deep },
    ], {
      maxBlocks: 32,
      maxEncodedBytes: 256 * 1024,
      maxTextChars: 100_000,
      maxJsonDepth: 8,
      maxResources: 8,
    })).toThrow(McpResultBudgetError);
  });

  it('accepts bounded text results', () => {
    const result = materializeMcpToolResult([
      { type: 'text', text: 'hello' },
      { type: 'text', text: 'world' },
    ]);
    expect(result.text).toBe('hello\nworld');
    expect(result.blockCount).toBe(2);
  });

  it('builds vault-relative artifact paths and caps serialized artifact bytes', () => {
    const artifactPath = buildMcpArtifactVaultPath('demo server', 'tool/name', 1_700_000_000_000);
    expect(artifactPath.startsWith('.pivi/artifacts/mcp/')).toBe(true);
    expect(artifactPath).toContain('demo_server');
    expect(artifactPath).toContain('tool_name');
    expect(artifactPath.includes('..')).toBe(false);

    const huge = 'x'.repeat(MCP_ARTIFACT_MAX_BYTES + 4_096);
    const serialized = serializeBoundedMcpArtifact([{ type: 'text', text: huge }], 'max-text-chars');
    expect(Buffer.byteLength(serialized, 'utf8')).toBeLessThanOrEqual(MCP_ARTIFACT_MAX_BYTES);
    expect(serialized).toContain('truncated');
    expect(formatMcpArtifactReference('demo', 'tool', 'max-blocks', artifactPath)).toContain(artifactPath);
  });
});

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
});
