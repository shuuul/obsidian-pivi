import type {
  McpManagementCommitResult,
  McpManagementCoordinator,
  McpManagementPlan,
} from '@pivi/agent/mcp/mcpManagementCoordinator';
import type {
  SkillsManagementCommitResult,
  SkillsManagementCoordinator,
  SkillsManagementPlan,
} from '@pivi/agent/skills/vault/skillsManagementCoordinator';
import {
  TOOL_PIVI_COMMANDS,
  TOOL_PIVI_MCP,
  TOOL_PIVI_PROMPT,
  TOOL_PIVI_SKILLS,
} from '@pivi/agent/tools';
import {
  type PiviManagementApprovalDecision,
  type PiviManagementApprovalPort,
  type PiviManagementApprovalRequest,
  PiviManagementError,
} from '@pivi/agent/tools/piviManagement';

import {
  PiviCommandsManagementError,
  type PiSlashCommandCatalog,
} from '@/app/runtime/PiSlashCommandCatalog';
import {
  createPiviManagementMainOnlyToolProviderFactory,
  createPiviManagementPort,
  type PiviManagementRefreshHost,
  type PiviManagementServiceDeps,
} from '@/app/runtime/PiviManagementService';

function makeApproval(
  decision: PiviManagementApprovalDecision | (() => Promise<PiviManagementApprovalDecision>),
): {
  port: PiviManagementApprovalPort;
  requests: PiviManagementApprovalRequest[];
} {
  const requests: PiviManagementApprovalRequest[] = [];
  return {
    requests,
    port: {
      async requestApproval(request) {
        requests.push(request);
        return typeof decision === 'function' ? decision() : decision;
      },
    },
  };
}

function makeDeps(overrides?: {
  approvalDecision?: PiviManagementApprovalDecision;
  mcpCommit?: jest.Mock;
  skillsCommit?: jest.Mock;
  commandsExecute?: jest.Mock;
  commandsCommit?: jest.Mock;
  promptCommit?: jest.Mock;
  refresh?: jest.Mock;
}): {
  deps: PiviManagementServiceDeps;
  mcp: {
    query: jest.Mock;
    test: jest.Mock;
    plan: jest.Mock;
    commit: jest.Mock;
  };
  skills: {
    snapshot: jest.Mock;
    listRemote: jest.Mock;
    plan: jest.Mock;
    commit: jest.Mock;
  };
  commands: { executeCommands: jest.Mock; planCommands: jest.Mock; commitCommands: jest.Mock };
  prompt: { queryList: jest.Mock; queryGet: jest.Mock; plan: jest.Mock; commit: jest.Mock };
  refresh: jest.Mock;
  refreshHost: PiviManagementRefreshHost;
} {
  const mcpPlan: McpManagementPlan = {
    revision: 'mcp-rev-1',
    mutation: {
      action: 'set_enabled',
      name: 'demo',
      enabled: true,
    },
  };
  const mcpCommitResult: McpManagementCommitResult = {
    revision: 'mcp-rev-2',
    saved: true,
    refreshed: true,
    effective: {
      name: 'demo',
      type: 'http',
      enabled: true,
      contextSaving: false,
      url: 'https://example.test',
    },
  };
  const skillsPlan: SkillsManagementPlan = {
    revision: 'skills-rev-1',
    mutation: { action: 'set_enabled', name: 'demo-skill', enabled: false },
  };
  const skillsCommitResult: SkillsManagementCommitResult = {
    revision: 'skills-rev-2',
    skills: [{ name: 'demo-skill', enabled: false }],
    refreshed: true,
  };

  const mcp = {
    query: jest.fn(async () => ({ servers: [{ name: 'demo' }] })),
    test: jest.fn(async () => ({ name: 'demo', success: true })),
    plan: jest.fn(async (mutation) => ({
      revision: mcpPlan.revision,
      mutation: structuredClone(mutation ?? mcpPlan.mutation),
    })),
    commit: overrides?.mcpCommit ?? jest.fn(async () => mcpCommitResult),
  };
  const skills = {
    snapshot: jest.fn(() => ({
      skills: [{ name: 'demo-skill', enabled: true }],
      revision: 'skills-rev-1',
    })),
    listRemote: jest.fn(async () => ({
      source: 'owner/repo',
      skills: [{ name: 'remote-skill' }],
    })),
    plan: jest.fn((mutation) => ({
      revision: skillsPlan.revision,
      mutation: structuredClone(mutation ?? skillsPlan.mutation),
    })),
    commit: overrides?.skillsCommit ?? jest.fn(async () => skillsCommitResult),
  };
  const commands = {
    executeCommands: overrides?.commandsExecute ?? jest.fn(async (input) => {
      if (input.action === 'list') {
        return { commands: [{ id: 'hello', name: 'hello' }], catalogRevision: 7 };
      }
      if (input.action === 'get') {
        return {
          command: { id: 'hello', name: 'hello', content: 'Say hi' },
          catalogRevision: 7,
        };
      }
      return {
        saved: true,
        refreshed: true,
        effective: { id: input.id, name: input.id, content: 'body' },
      };
    }),
    planCommands: jest.fn(async (input) => ({ revision: input.catalogRevision, mutation: structuredClone(input) })),
    commitCommands: overrides?.commandsCommit ?? jest.fn(async (plan) => ({
      saved: true,
      refreshed: true,
      effective: { id: plan.mutation.id, name: plan.mutation.id, content: 'body' },
    })),
  };
  const prompt = {
    queryList: jest.fn(() => ({
      catalogRevision: 3,
      modules: [{ id: 'transcript-cleanup', kind: 'workflow', title: 'Transcript cleanup', enabled: true, modified: false }],
    })),
    queryGet: jest.fn(() => ({
      catalogRevision: 3,
      module: {
        id: 'transcript-cleanup',
        kind: 'workflow',
        title: 'Transcript cleanup',
        enabled: true,
        modified: false,
        body: 'Cleanup body',
      },
    })),
    plan: jest.fn((input) => ({ revision: input.catalogRevision, mutation: structuredClone(input) })),
    commit: overrides?.promptCommit ?? jest.fn(async () => ({
      saved: true,
      refreshed: false,
      effective: { catalogRevision: 4 },
    })),
  };
  const refresh = overrides?.refresh ?? jest.fn(async () => [] as const);
  const refreshHost: PiviManagementRefreshHost = {
    refreshPiviManagement: refresh,
  };
  return {
    deps: {
      mcp: mcp as unknown as McpManagementCoordinator,
      skills: skills as unknown as SkillsManagementCoordinator,
      commands: commands as unknown as PiSlashCommandCatalog,
      prompt: prompt as unknown as PiviManagementServiceDeps['prompt'],
      refresh: refreshHost,
    },
    mcp,
    skills,
    commands,
    prompt,
    refresh,
    refreshHost,
  };
}

describe('PiviManagementService', () => {
  it('runs MCP/Skills/Commands/Prompt queries without approval or mutation', async () => {
    const { deps, mcp, skills, commands, prompt, refresh } = makeDeps();
    const approval = makeApproval('confirm');
    const port = createPiviManagementPort(deps, approval.port);

    await expect(port.executeMcp({ action: 'list' })).resolves.toEqual({
      servers: [{ name: 'demo' }],
    });
    await expect(port.executeMcp({ action: 'test', name: 'demo' })).resolves.toEqual({
      name: 'demo',
      success: true,
    });
    await expect(port.executeSkills({ action: 'list' })).resolves.toEqual({
      skills: [{ name: 'demo-skill', enabled: true }],
    });
    await expect(port.executeSkills({ action: 'list_remote', source: 'owner/repo' })).resolves.toEqual({
      source: 'owner/repo',
      skills: [{ name: 'remote-skill' }],
    });
    await expect(port.executeCommands({ action: 'list' })).resolves.toEqual({
      commands: [{ id: 'hello', name: 'hello' }],
      catalogRevision: 7,
    });
    await expect(port.executeCommands({ action: 'get', id: 'hello' })).resolves.toMatchObject({
      command: { id: 'hello', content: 'Say hi' },
      catalogRevision: 7,
    });
    await expect(port.executePrompt({ action: 'list' })).resolves.toEqual({
      catalogRevision: 3,
      modules: [{ id: 'transcript-cleanup', kind: 'workflow', title: 'Transcript cleanup', enabled: true, modified: false }],
    });
    await expect(port.executePrompt({ action: 'get', id: 'transcript-cleanup' })).resolves.toMatchObject({
      module: { id: 'transcript-cleanup', body: 'Cleanup body' },
      catalogRevision: 3,
    });

    expect(approval.requests).toHaveLength(0);
    expect(mcp.plan).not.toHaveBeenCalled();
    expect(mcp.commit).not.toHaveBeenCalled();
    expect(skills.plan).not.toHaveBeenCalled();
    expect(skills.commit).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
    expect(commands.executeCommands).toHaveBeenCalledTimes(2);
    expect(prompt.plan).not.toHaveBeenCalled();
    expect(prompt.commit).not.toHaveBeenCalled();
  });

  /* The table intentionally exercises fulfilled and rejected branches. */
  /* eslint-disable jest/no-conditional-expect -- Each decision row has a distinct expected settlement. */
  it.each([
    ['confirm', true],
    ['deny', false],
    ['cancel', false],
  ] as const)('MCP mutation %s maps decision and commit side effects', async (decision, commits) => {
    const { deps, mcp, refresh } = makeDeps();
    const approval = makeApproval(decision);
    const port = createPiviManagementPort(deps, approval.port);

    if (commits) {
      await expect(port.executeMcp({
        action: 'set_enabled',
        name: 'demo',
        enabled: true,
      })).resolves.toMatchObject({ saved: true, refreshed: true });
      expect(mcp.commit).toHaveBeenCalledWith(
        expect.objectContaining({ revision: 'mcp-rev-1' }),
        'mcp-rev-1',
        undefined,
      );
      expect(refresh).toHaveBeenCalledWith('mcp');
    } else {
      await expect(port.executeMcp({
        action: 'set_enabled',
        name: 'demo',
        enabled: true,
      })).rejects.toMatchObject({
        name: 'PiviManagementError',
        code: decision === 'deny' ? 'denied' : 'cancelled',
      });
      expect(mcp.commit).not.toHaveBeenCalled();
      expect(refresh).not.toHaveBeenCalled();
    }
  });

  it.each([
    ['confirm', true],
    ['deny', false],
    ['cancel', false],
  ] as const)('Skills mutation %s maps decision and commit side effects', async (decision, commits) => {
    const { deps, skills, refresh } = makeDeps();
    const approval = makeApproval(decision);
    const port = createPiviManagementPort(deps, approval.port);

    if (commits) {
      await expect(port.executeSkills({
        action: 'set_enabled',
        name: 'demo-skill',
        enabled: false,
      })).resolves.toMatchObject({
        saved: true,
        refreshed: true,
        effective: { skills: [{ name: 'demo-skill', enabled: false }] },
      });
      expect(skills.commit).toHaveBeenCalledWith(
        expect.objectContaining({ revision: 'skills-rev-1' }),
        'skills-rev-1',
        undefined,
      );
      expect(refresh).toHaveBeenCalledWith('skills');
    } else {
      await expect(port.executeSkills({
        action: 'set_enabled',
        name: 'demo-skill',
        enabled: false,
      })).rejects.toMatchObject({
        code: decision === 'deny' ? 'denied' : 'cancelled',
      });
      expect(skills.commit).not.toHaveBeenCalled();
      expect(refresh).not.toHaveBeenCalled();
    }
  });

  it.each([
    ['confirm', true],
    ['deny', false],
    ['cancel', false],
  ] as const)('Commands mutation %s approves then uses catalog revision CAS', async (decision, commits) => {
    const { deps, commands, refresh } = makeDeps();
    const approval = makeApproval(decision);
    const port = createPiviManagementPort(deps, approval.port);
    const input = {
      action: 'remove' as const,
      id: 'hello',
      catalogRevision: 7,
    };

    if (commits) {
      await expect(port.executeCommands(input)).resolves.toMatchObject({
        saved: true,
        refreshed: true,
      });
      expect(commands.planCommands).toHaveBeenCalledWith(input, undefined);
      expect(commands.commitCommands).toHaveBeenCalledWith(
        expect.objectContaining({ revision: 7, mutation: input }),
        7,
        undefined,
      );
      expect(refresh).toHaveBeenCalledWith('commands');
    } else {
      await expect(port.executeCommands(input)).rejects.toMatchObject({
        code: decision === 'deny' ? 'denied' : 'cancelled',
      });
      expect(commands.commitCommands).not.toHaveBeenCalled();
      expect(refresh).not.toHaveBeenCalled();
    }
  });

  it.each([
    ['confirm', true],
    ['deny', false],
    ['cancel', false],
  ] as const)('Prompt mutation %s approves then uses catalog revision CAS', async (decision, commits) => {
    const { deps, prompt, refresh } = makeDeps();
    const approval = makeApproval(decision);
    const port = createPiviManagementPort(deps, approval.port);
    const input = {
      action: 'set_enabled' as const,
      id: 'transcript-cleanup',
      enabled: false,
      catalogRevision: 3,
    };

    if (commits) {
      await expect(port.executePrompt(input)).resolves.toMatchObject({
        saved: true,
        effective: { catalogRevision: 4 },
      });
      expect(prompt.plan).toHaveBeenCalledWith(input);
      expect(prompt.commit).toHaveBeenCalledWith(
        expect.objectContaining({ revision: 3, mutation: input }),
        3,
      );
      expect(refresh).toHaveBeenCalledWith('prompt');
    } else {
      await expect(port.executePrompt(input)).rejects.toMatchObject({
        code: decision === 'deny' ? 'denied' : 'cancelled',
      });
      expect(prompt.commit).not.toHaveBeenCalled();
      expect(refresh).not.toHaveBeenCalled();
    }
  });
  /* eslint-enable jest/no-conditional-expect -- End decision matrix. */

  it('fails closed with unavailable when approval port is null', async () => {
    const { deps, mcp, skills, commands, refresh } = makeDeps();
    const port = createPiviManagementPort(deps, null);

    await expect(port.executeMcp({ action: 'list' })).resolves.toBeDefined();
    await expect(port.executeSkills({ action: 'list' })).resolves.toBeDefined();
    await expect(port.executeCommands({ action: 'list' })).resolves.toBeDefined();
    await expect(port.executePrompt({ action: 'list' })).resolves.toBeDefined();

    await expect(port.executeMcp({
      action: 'remove',
      name: 'demo',
    })).rejects.toBeInstanceOf(PiviManagementError);
    await expect(port.executeMcp({
      action: 'remove',
      name: 'demo',
    })).rejects.toMatchObject({ code: 'unavailable' });
    await expect(port.executeSkills({
      action: 'remove',
      name: 'demo-skill',
    })).rejects.toMatchObject({ code: 'unavailable' });
    await expect(port.executeCommands({
      action: 'remove',
      id: 'hello',
      catalogRevision: 7,
    })).rejects.toMatchObject({ code: 'unavailable' });
    await expect(port.executePrompt({
      action: 'remove',
      id: 'custom:a',
      catalogRevision: 3,
    })).rejects.toMatchObject({ code: 'unavailable' });

    expect(mcp.commit).not.toHaveBeenCalled();
    expect(skills.commit).not.toHaveBeenCalled();
    expect(commands.executeCommands).toHaveBeenCalledTimes(1);
    expect(commands.commitCommands).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
  });

  it('commits with the exact planned revision and never auto-replays state_changed', async () => {
    const commit = jest.fn(async () => {
      throw new PiviManagementError('state_changed', 'MCP configuration changed after planning.');
    });
    const { deps, mcp, refresh } = makeDeps({ mcpCommit: commit });
    const approval = makeApproval('confirm');
    const port = createPiviManagementPort(deps, approval.port);

    await expect(port.executeMcp({
      action: 'set_enabled',
      name: 'demo',
      enabled: true,
    })).rejects.toMatchObject({ code: 'state_changed' });

    expect(mcp.plan).toHaveBeenCalledTimes(1);
    expect(commit).toHaveBeenCalledTimes(1);
    expect(commit).toHaveBeenCalledWith(
      expect.objectContaining({ revision: 'mcp-rev-1' }),
      'mcp-rev-1',
      undefined,
    );
    expect(refresh).not.toHaveBeenCalled();
  });

  it('maps command catalog state_changed without retry', async () => {
    const commitCommands = jest.fn(async () => {
      throw new PiviCommandsManagementError('state_changed', 'Command catalog changed');
    });
    const { deps, refresh } = makeDeps({ commandsCommit: commitCommands });
    const approval = makeApproval('confirm');
    const port = createPiviManagementPort(deps, approval.port);

    await expect(port.executeCommands({
      action: 'remove',
      id: 'hello',
      catalogRevision: 7,
    })).rejects.toMatchObject({ code: 'state_changed' });
    expect(commitCommands).toHaveBeenCalledTimes(1);
    expect(refresh).not.toHaveBeenCalled();
  });

  it('maps prompt catalog state_changed without retry', async () => {
    const promptCommit = jest.fn(async () => {
      throw new PiviManagementError('state_changed', 'Prompt composition changed');
    });
    const { deps, refresh } = makeDeps({ promptCommit });
    const approval = makeApproval('confirm');
    const port = createPiviManagementPort(deps, approval.port);

    await expect(port.executePrompt({
      action: 'restore',
      id: 'transcript-cleanup',
      catalogRevision: 3,
    })).rejects.toMatchObject({ code: 'state_changed' });
    expect(promptCommit).toHaveBeenCalledTimes(1);
    expect(refresh).not.toHaveBeenCalled();
  });

  it('sanitizes approval requests without raw config, secrets, prompt bodies, or Agent prose', async () => {
    const { deps } = makeDeps();
    const approval = makeApproval('deny');
    const port = createPiviManagementPort(deps, approval.port);

    await expect(port.executeMcp({
      action: 'upsert',
      name: 'secure',
      server: {
        type: 'http',
        url: 'https://example.test',
        auth: 'bearer',
        description: 'AGENT-PROVIDED PROSE MUST NOT APPEAR',
        bearerToken: { source: 'systemEnvironment', variable: 'TOKEN' },
        headers: {
          Authorization: { source: 'systemEnvironment', variable: 'AUTH' },
          'X-Plain': { source: 'plain', value: 'should-not-appear-as-raw-map' },
        },
      },
    })).rejects.toMatchObject({ code: 'denied' });

    await expect(port.executeCommands({
      action: 'upsert',
      id: 'secret-cmd',
      content: 'PROMPT BODY MUST NOT APPEAR',
      catalogRevision: 9,
      description: 'AGENT COMMAND DESCRIPTION',
      argumentHint: 'AGENT ARGUMENT HINT',
    })).rejects.toMatchObject({ code: 'denied' });

    await expect(port.executePrompt({
      action: 'upsert',
      body: 'AGENT MODULE BODY MUST NOT APPEAR',
      title: 'Secret module',
      catalogRevision: 3,
    })).rejects.toMatchObject({ code: 'denied' });

    expect(approval.requests).toHaveLength(3);
    const mcpRequest = approval.requests[0]!;
    const commandsRequest = approval.requests[1]!;

    expect(mcpRequest).toMatchObject({
      domain: 'mcp',
      action: 'upsert',
      title: 'Update MCP server "secure"',
      revision: 'mcp-rev-1',
    });
    expect(Object.isFrozen(mcpRequest)).toBe(true);
    const encoded = JSON.stringify(approval.requests);
    expect(encoded).not.toContain('should-not-appear-as-raw-map');
    expect(encoded).not.toContain('PROMPT BODY MUST NOT APPEAR');
    expect(encoded).not.toContain('AGENT-PROVIDED PROSE MUST NOT APPEAR');
    expect(encoded).not.toContain('AGENT COMMAND DESCRIPTION');
    expect(encoded).not.toContain('AGENT ARGUMENT HINT');
    expect(encoded).not.toContain('AGENT MODULE BODY MUST NOT APPEAR');
    expect(encoded).not.toMatch(/"headers"\s*:\s*\{/);
    expect(mcpRequest.fields?.some((field) => field.label === 'Header names')).toBe(true);
    expect(mcpRequest.fields?.some((field) => (
      field.label === 'Bearer token' && field.value === 'env:TOKEN'
    ))).toBe(true);
    expect(mcpRequest.fields?.some((field) => field.label === 'Description')).toBe(false);

    expect(commandsRequest).toMatchObject({
      domain: 'commands',
      action: 'upsert',
      revision: 9,
    });
    expect(commandsRequest.fields?.some((field) => (
      field.label === 'Prompt' && field.value === 'Updated'
    ))).toBe(true);
    expect(commandsRequest.fields?.some((field) => field.label === 'Description')).toBe(false);

    const promptRequest = approval.requests[2]!;
    expect(promptRequest).toMatchObject({
      domain: 'prompt',
      action: 'upsert',
      revision: 3,
    });
    expect(promptRequest.fields?.some((field) => (
      field.label === 'Prompt' && field.value === 'Updated'
    ))).toBe(true);
    expect(JSON.stringify(promptRequest)).not.toContain('AGENT MODULE BODY MUST NOT APPEAR');
    expect(commandsRequest.fields?.some((field) => field.label === 'Argument hint')).toBe(false);
  });

  it('returns saved:true refreshed:false when durable commit refresh fails', async () => {
    const refresh = jest.fn(async () => [
      { target: 'view:1/tab:a', message: 'Runtime refresh failed.' },
    ]);
    const { deps } = makeDeps({ refresh });
    const approval = makeApproval('confirm');
    const port = createPiviManagementPort(deps, approval.port);

    await expect(port.executeMcp({
      action: 'set_enabled',
      name: 'demo',
      enabled: true,
    })).resolves.toEqual(expect.objectContaining({
      saved: true,
      refreshed: false,
      warnings: expect.arrayContaining([
        expect.stringContaining('saved'),
      ]),
      refreshFailures: expect.arrayContaining([
        expect.objectContaining({
          target: 'view:1/tab:a',
          message: 'Runtime refresh failed.',
        }),
      ]),
    }));
  });

  it('sanitizes coordinator refreshFailures and still attempts host refresh', async () => {
    const mcpCommit = jest.fn(async (): Promise<McpManagementCommitResult> => ({
      revision: 'mcp-rev-2',
      saved: true,
      refreshed: false,
      effective: {
        name: 'demo',
        type: 'http',
        enabled: true,
        contextSaving: false,
      },
      warnings: ['MCP configuration was saved, but some post-save cleanup or refresh work failed.'],
      refreshFailures: [{
        target: 'runtime',
        message: 'publish failed with secret /Users/me/.pivi/token',
      }],
    }));
    const refresh = jest.fn(async () => [
      { target: 'view:1/tab:b', message: 'Runtime refresh failed.' },
    ]);
    const { deps } = makeDeps({ mcpCommit, refresh });
    const approval = makeApproval('confirm');
    const port = createPiviManagementPort(deps, approval.port);

    const result = await port.executeMcp({
      action: 'set_enabled',
      name: 'demo',
      enabled: true,
    });
    expect(result).toEqual(expect.objectContaining({
      saved: true,
      refreshed: false,
    }));
    const failures = (result as { refreshFailures?: Array<{ target: string; message: string }> })
      .refreshFailures ?? [];
    expect(failures).toEqual(expect.arrayContaining([
      { target: 'runtime', message: 'Runtime refresh failed.' },
      { target: 'view:1/tab:b', message: 'Runtime refresh failed.' },
    ]));
    expect(JSON.stringify(failures)).not.toContain('/Users/me');
    expect(JSON.stringify(failures)).not.toContain('token');
    expect(refresh).toHaveBeenCalledWith('mcp');
  });

  it('bounds refreshFailures to 20 and keeps saved:true when host returns many targets', async () => {
    const many = Array.from({ length: 25 }, (_, index) => ({
      target: `view:1/tab:${index}`,
      message: 'Runtime refresh failed.',
    }));
    const refresh = jest.fn(async () => many);
    const { deps } = makeDeps({ refresh });
    const approval = makeApproval('confirm');
    const port = createPiviManagementPort(deps, approval.port);

    const result = await port.executeMcp({
      action: 'set_enabled',
      name: 'demo',
      enabled: true,
    }) as { saved: boolean; refreshed: boolean; refreshFailures?: unknown[] };

    expect(result.saved).toBe(true);
    expect(result.refreshed).toBe(false);
    expect(result.refreshFailures).toHaveLength(20);
  });

  it('registers sequential main-only management tools from the provider factory', () => {
    const { deps } = makeDeps();
    const factory = createPiviManagementMainOnlyToolProviderFactory(deps);
    const provider = factory(null);
    const result = provider({ vaultPath: '/tmp/vault' });

    expect(result.toolSpecs.map((tool) => tool.name)).toEqual([
      TOOL_PIVI_MCP,
      TOOL_PIVI_SKILLS,
      TOOL_PIVI_COMMANDS,
      TOOL_PIVI_PROMPT,
    ]);
    for (const tool of result.toolSpecs) {
      expect(tool.executionMode).toBe('sequential');
    }
  });

  it('filters disabled management tools only from the main-Agent provider', () => {
    const { deps } = makeDeps();
    const factory = createPiviManagementMainOnlyToolProviderFactory(
      deps,
      () => [TOOL_PIVI_MCP, TOOL_PIVI_COMMANDS],
    );
    const result = factory(null)({ vaultPath: '/tmp/vault' });

    expect(result.toolSpecs.map(tool => tool.name)).toEqual([TOOL_PIVI_SKILLS, TOOL_PIVI_PROMPT]);
  });
});
