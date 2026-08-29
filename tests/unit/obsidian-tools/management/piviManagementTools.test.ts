import { spawnSync } from 'node:child_process';
import { buildRegisteredToolsSection } from '@pivi/agent/prompt';
import {
  createPiviCommandsTool,
  createPiviMcpTool,
  createPiviSkillsTool,
  parsePiviCommandsInput,
  parsePiviMcpInput,
  parsePiviSkillsInput,
  PIVI_COMMANDS_PARAMETERS,
  PIVI_MCP_PARAMETERS,
  PIVI_SKILLS_PARAMETERS,
  type PiviManagementPort,
  TOOL_PIVI_COMMANDS,
  TOOL_PIVI_MCP,
  TOOL_PIVI_SKILLS,
} from '@pivi/agent/tools';
import { toPiAgentTool } from '@pivi/engine-pi/piToolAdapter';
import {
  getToolPresentationDescriptor,
  MCP_ICON_MARKER,
} from '@pivi/agent/tools/toolPresentation';
import { Validator } from '@cfworker/json-schema';

function getText(result: unknown): string {
  const content = (result as { content: Array<{ text: string }> }).content;
  return content[0]?.text ?? '';
}

function listActionConsts(parameters: { readonly oneOf: readonly unknown[] }): string[] {
  return parameters.oneOf.map((variant) => {
    const record = variant as {
      properties: { action: { const: string } };
    };
    return record.properties.action.const;
  });
}

function makePort(): {
  executeMcp: jest.MockedFunction<PiviManagementPort['executeMcp']>;
  executeSkills: jest.MockedFunction<PiviManagementPort['executeSkills']>;
  executeCommands: jest.MockedFunction<PiviManagementPort['executeCommands']>;
} {
  return {
    executeMcp: jest.fn(async (input) => ({ ok: true, domain: 'mcp', input })),
    executeSkills: jest.fn(async (input) => ({ ok: true, domain: 'skills', input })),
    executeCommands: jest.fn(async (input) => ({ ok: true, domain: 'commands', input })),
  };
}

type ProtocolApi =
  | 'anthropic-messages'
  | 'google-generative-ai'
  | 'openai-codex-responses'
  | 'openai-completions'
  | 'openai-responses';

function serializeThroughProtocol(api: ProtocolApi): Record<string, unknown>[] {
  const port = makePort();
  const tools = [
    createPiviMcpTool(port),
    createPiviSkillsTool(port),
    createPiviCommandsTool(port),
  ].map(toPiAgentTool).map(({ name, label, description, parameters }) => ({
    name,
    label,
    description,
    parameters,
  }));
  const script = String.raw`
    import fs from 'node:fs';

    const api = process.argv[1];
    const tools = JSON.parse(fs.readFileSync(0, 'utf8'));
    const providers = {
      'anthropic-messages': ['anthropic-messages.lazy', 'anthropicMessagesApi'],
      'google-generative-ai': ['google-generative-ai.lazy', 'googleGenerativeAIApi'],
      'openai-codex-responses': ['openai-codex-responses.lazy', 'openAICodexResponsesApi'],
      'openai-completions': ['openai-completions.lazy', 'openAICompletionsApi'],
      'openai-responses': ['openai-responses.lazy', 'openAIResponsesApi'],
    };
    const [moduleName, exportName] = providers[api];
    const provider = (await import('@earendil-works/pi-ai/api/' + moduleName))[exportName];
    const model = {
      id: 'pivi-schema-fixture',
      name: 'Pivi schema fixture',
      api,
      provider: api === 'openai-codex-responses' ? 'openai-codex' : 'pivi-fixture',
      baseUrl: api === 'openai-codex-responses'
        ? 'https://chatgpt.com/backend-api'
        : 'https://example.com/v1',
      reasoning: false,
      input: ['text'],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 1000,
      maxTokens: 100,
    };
    const tokenPayload = Buffer.from(JSON.stringify({
      'https://api.openai.com/auth': { chatgpt_account_id: 'pivi-fixture' },
    })).toString('base64url');
    let payload;
    const stream = provider().stream(model, { messages: [], tools }, {
      apiKey: api === 'openai-codex-responses'
        ? 'header.' + tokenPayload + '.signature'
        : 'pivi-test-key',
      ...(api === 'openai-codex-responses' ? { transport: 'sse' } : {}),
      onPayload(value) {
        payload = value;
        throw new Error('pivi schema payload captured');
      },
    });
    await stream.result();
    if (!payload) throw new Error('protocol did not expose a payload');

    let schemas;
    if (api === 'openai-completions') {
      schemas = payload.tools.map((tool) => tool.function.parameters);
    } else if (api === 'anthropic-messages') {
      schemas = payload.tools.map((tool) => tool.input_schema);
    } else if (api === 'google-generative-ai') {
      schemas = payload.config.tools[0].functionDeclarations.map(
        (tool) => tool.parametersJsonSchema,
      );
    } else {
      schemas = payload.tools.map((tool) => tool.parameters);
    }
    process.stdout.write(JSON.stringify(schemas));
  `;
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', script, api], {
    cwd: process.cwd(),
    encoding: 'utf8',
    input: JSON.stringify(tools),
    maxBuffer: 2 * 1024 * 1024,
  });
  expect(result.status).toBe(0);
  expect(result.stderr).toBe('');
  return JSON.parse(result.stdout) as Record<string, unknown>[];
}

describe('pivi management tool contracts', () => {
  it('exposes exact action sets via oneOf schemas', () => {
    expect(listActionConsts(PIVI_MCP_PARAMETERS)).toEqual([
      'list', 'test', 'upsert', 'set_enabled', 'remove',
    ]);
    expect(listActionConsts(PIVI_SKILLS_PARAMETERS)).toEqual([
      'list', 'list_remote', 'install', 'set_enabled', 'update', 'update_all', 'remove',
    ]);
    expect(listActionConsts(PIVI_COMMANDS_PARAMETERS)).toEqual([
      'list', 'get', 'upsert', 'remove', 'move',
    ]);
  });

  it('declares an object root for every management schema', () => {
    for (const schema of [PIVI_MCP_PARAMETERS, PIVI_SKILLS_PARAMETERS, PIVI_COMMANDS_PARAMETERS]) {
      expect(schema.type).toBe('object');
    }
  });

  it.each([
    ['OpenAI Chat Completions', 'openai-completions'],
    ['OpenAI Responses', 'openai-responses'],
    ['OpenAI Codex Responses', 'openai-codex-responses'],
    ['Anthropic Messages', 'anthropic-messages'],
    ['Google Generative AI', 'google-generative-ai'],
  ] as const)('serializes usable object schemas through %s', (_label, api) => {
    const schemas = serializeThroughProtocol(api);

    expect(schemas).toHaveLength(3);
    const expectedActions = [
      listActionConsts(PIVI_MCP_PARAMETERS),
      listActionConsts(PIVI_SKILLS_PARAMETERS),
      listActionConsts(PIVI_COMMANDS_PARAMETERS),
    ];
    for (const [index, schema] of schemas.entries()) {
      expect(schema).toMatchObject({
        type: 'object',
        properties: { action: { type: 'string', enum: expectedActions[index] } },
        required: expect.arrayContaining(['action']),
      });
    }
  });

  it('marks every management ToolSpec sequential with canonical names', () => {
    const port = makePort();
    const tools = [
      createPiviMcpTool(port),
      createPiviSkillsTool(port),
      createPiviCommandsTool(port),
    ];
    expect(tools.map((tool) => tool.name)).toEqual([
      TOOL_PIVI_MCP,
      TOOL_PIVI_SKILLS,
      TOOL_PIVI_COMMANDS,
    ]);
    for (const tool of tools) {
      expect(tool.executionMode).toBe('sequential');
      expect(tool.parameters).toHaveProperty('oneOf');
    }
  });

  it('rejects additionalProperties on every action variant', () => {
    for (const schema of [PIVI_MCP_PARAMETERS, PIVI_SKILLS_PARAMETERS, PIVI_COMMANDS_PARAMETERS]) {
      for (const variant of schema.oneOf) {
        expect((variant as { additionalProperties: boolean }).additionalProperties).toBe(false);
      }
    }
  });

  it('structurally omits raw MCP secret fields from schemas', () => {
    const encoded = JSON.stringify(PIVI_MCP_PARAMETERS);
    for (const forbidden of [
      'clientSecret',
      'bearerTokenEnv',
      '"token"',
      'password',
      'apiKey',
      'api_key',
    ]) {
      expect(encoded).not.toContain(forbidden);
    }
    // bearerToken is allowed only as structured source object, never a string type leaf
    expect(encoded).toContain('bearerToken');
    expect(encoded).toContain('systemEnvironment');
    expect(encoded).toContain('clear');
  });

  it('structurally omits Skill content publication fields from schemas', () => {
    const encoded = JSON.stringify(PIVI_SKILLS_PARAMETERS);
    for (const forbidden of [
      'content', 'files', 'SKILL.md', 'sourceTree', 'destination', 'publish', 'body',
    ]) {
      expect(encoded).not.toContain(forbidden);
    }
  });

  it('requires catalogRevision on every command mutation and encodes move anchor XOR', () => {
    const schema = JSON.parse(JSON.stringify(PIVI_COMMANDS_PARAMETERS)) as ConstructorParameters<typeof Validator>[0];
    const validator = new Validator(schema);
    const isValid = (value: unknown) => validator.validate(value).valid;
    expect(isValid({ action: 'upsert', id: 'a', content: 'body' })).toBe(false);
    expect(isValid({ action: 'remove', id: 'a' })).toBe(false);
    expect(isValid({ action: 'move', id: 'a', beforeId: 'b' })).toBe(false);
    expect(isValid({ action: 'move', id: 'a', catalogRevision: 1 })).toBe(false);
    expect(isValid({
      action: 'move', id: 'a', beforeId: 'b', afterId: 'c', catalogRevision: 1,
    })).toBe(false);
    expect(isValid({ action: 'move', id: 'a', beforeId: 'b', catalogRevision: 1 })).toBe(true);
    expect(isValid({ action: 'move', id: 'a', afterId: 'b', catalogRevision: 1 })).toBe(true);

    const move = PIVI_COMMANDS_PARAMETERS.oneOf.find(
      (variant) => (variant as { properties: { action: { const: string } } }).properties.action.const === 'move',
    ) as unknown as { required: readonly string[] };
    const upsert = PIVI_COMMANDS_PARAMETERS.oneOf.find(
      (variant) => (variant as { properties: { action: { const: string } } }).properties.action.const === 'upsert',
    ) as unknown as { required: readonly string[]; properties: Record<string, unknown> };
    expect([...move.required]).toEqual(expect.arrayContaining(['catalogRevision', 'id', 'action']));
    expect([...upsert.required]).toEqual(expect.arrayContaining(['content', 'catalogRevision', 'id', 'action']));
    expect(upsert.properties).not.toHaveProperty('integrationKey');
    expect(upsert.properties).not.toHaveProperty('revision');
  });
});

describe('pivi management runtime validation', () => {
  it('rejects non-object params and unknown actions before calling the port', async () => {
    const port = makePort();
    const mcp = createPiviMcpTool(port);
    const skills = createPiviSkillsTool(port);
    const commands = createPiviCommandsTool(port);

    await expect(mcp.execute('1', null)).rejects.toThrow('must be an object');
    await expect(mcp.execute('1', { action: 'rename' })).rejects.toThrow('Unknown pivi_mcp action');
    await expect(skills.execute('1', { action: 'publish' })).rejects.toThrow('Unknown pivi_skills action');
    await expect(commands.execute('1', { action: 'reorder' })).rejects.toThrow('Unknown pivi_commands action');

    expect(port.executeMcp).not.toHaveBeenCalled();
    expect(port.executeSkills).not.toHaveBeenCalled();
    expect(port.executeCommands).not.toHaveBeenCalled();
  });

  it('rejects unsafe MCP secret inputs', () => {
    expect(() => parsePiviMcpInput({
      action: 'upsert',
      name: 'srv',
      server: {
        type: 'http',
        url: 'https://example.com',
        bearerToken: 'sk-live-secret',
      },
    })).toThrow('raw string secret');

    expect(() => parsePiviMcpInput({
      action: 'upsert',
      name: 'srv',
      server: {
        type: 'http',
        url: 'https://example.com',
        oauth: { clientSecret: 'shh' },
      },
    })).toThrow('clientSecret');

    expect(() => parsePiviMcpInput({
      action: 'upsert',
      name: 'srv',
      server: {
        type: 'http',
        url: 'https://example.com',
        headers: { Authorization: 'Bearer abc' },
      },
    })).toThrow('structured value reference');

    expect(() => parsePiviMcpInput({
      action: 'test',
      name: 'srv',
      bearerToken: 'nope',
    })).toThrow('unsafe field');
  });

  it('preserves omitted OAuth fields while allowing an explicit client-secret clear', () => {
    const clearInput = parsePiviMcpInput({
      action: 'upsert',
      name: 'srv',
      server: {
        type: 'http',
        url: 'https://example.com',
        oauth: { clearClientSecret: true },
      },
    });
    expect(clearInput).toMatchObject({
      server: { oauth: { clearClientSecret: true } },
    });
    const partialInput = parsePiviMcpInput({
      action: 'upsert',
      name: 'srv',
      server: {
        type: 'http',
        url: 'https://example.com',
        oauth: { clientId: 'client-id' },
      },
    });
    expect(partialInput).toMatchObject({
      server: { oauth: { clientId: 'client-id' } },
    });
    if (clearInput.action !== 'upsert') throw new Error('Expected an MCP upsert');
    if (!('oauth' in clearInput.server)) throw new Error('Expected a remote MCP server');
    expect(clearInput.server.oauth).toEqual({ clearClientSecret: true });
  });

  it('rejects Skill content/source-tree/destination fields', () => {
    expect(() => parsePiviSkillsInput({
      action: 'install',
      source: 'owner/repo',
      content: '---\nname: x\n',
    })).toThrow('content');

    expect(() => parsePiviSkillsInput({
      action: 'install',
      source: 'owner/repo',
      files: [{ path: 'SKILL.md', body: 'x' }],
    })).toThrow('files');

    expect(() => parsePiviSkillsInput({
      action: 'install',
      source: 'owner/repo',
      destination: '.pivi/skills/x',
    })).toThrow('destination');
  });

  it.each([
    '.', '..', './repo', '../repo', 'local/repo/../skill', '/tmp/repo',
    'C:\\repo', 'C:/repo', '\\\\server\\share', 'file:///tmp/repo',
  ])('rejects local Skill package source %s for list and install', (source) => {
    expect(() => parsePiviSkillsInput({ action: 'list_remote', source })).toThrow(/remote package source/);
    expect(() => parsePiviSkillsInput({ action: 'install', source })).toThrow(/remote package source/);
  });

  it.each([
    'owner/repo',
    'https://github.com/owner/repo.git',
    'https://github.com/owner/repo/tree/main/skills/demo',
    'git@github.com:owner/repo.git',
    'ssh://git@github.com/owner/repo.git',
  ])('accepts supported remote Skill package source %s', (source) => {
    expect(parsePiviSkillsInput({ action: 'list_remote', source })).toEqual({ action: 'list_remote', source });
  });

  it('requires catalogRevision and exclusive before/after for move', () => {
    expect(() => parsePiviCommandsInput({
      action: 'move',
      id: 'a',
      beforeId: 'b',
    })).toThrow('catalogRevision');

    expect(() => parsePiviCommandsInput({
      action: 'move',
      id: 'a',
      catalogRevision: 1,
      beforeId: 'b',
      afterId: 'c',
    })).toThrow('exactly one of beforeId or afterId');

    expect(parsePiviCommandsInput({
      action: 'move',
      id: 'a',
      afterId: 'c',
      catalogRevision: 3,
    })).toEqual({
      action: 'move',
      id: 'a',
      afterId: 'c',
      catalogRevision: 3,
    });
  });
});

describe('pivi management port forwarding', () => {
  it('forwards typed MCP input and AbortSignal', async () => {
    const port = makePort();
    const tool = createPiviMcpTool(port);
    const signal = new AbortController().signal;

    const result = await tool.execute('call-1', { action: 'list' }, signal);

    expect(port.executeMcp).toHaveBeenCalledWith({ action: 'list' }, signal);
    expect(JSON.parse(getText(result))).toMatchObject({ ok: true, domain: 'mcp' });
  });

  it('forwards skills install and commands get', async () => {
    const port = makePort();
    const skills = createPiviSkillsTool(port);
    const commands = createPiviCommandsTool(port);
    const signal = new AbortController().signal;

    await skills.execute('s1', {
      action: 'install',
      source: 'owner/repo',
      skillNames: ['defuddle'],
    }, signal);
    await commands.execute('c1', { action: 'get', id: 'summarize' }, signal);

    expect(port.executeSkills).toHaveBeenCalledWith({
      action: 'install',
      source: 'owner/repo',
      skillNames: ['defuddle'],
    }, signal);
    expect(port.executeCommands).toHaveBeenCalledWith({
      action: 'get',
      id: 'summarize',
    }, signal);
  });
});

describe('pivi management presentation and prompt', () => {
  it('registers canonical presentation descriptors', () => {
    expect(getToolPresentationDescriptor(TOOL_PIVI_MCP)).toMatchObject({
      kind: 'mcp',
      icon: MCP_ICON_MARKER,
      labelKey: 'tools.display.piviMcp',
    });
    expect(getToolPresentationDescriptor(TOOL_PIVI_SKILLS)).toMatchObject({
      kind: 'skill',
      icon: 'sparkles',
      labelKey: 'tools.display.piviSkills',
    });
    expect(getToolPresentationDescriptor(TOOL_PIVI_COMMANDS)).toMatchObject({
      kind: 'obsidian',
      icon: 'terminal',
      labelKey: 'tools.display.piviCommands',
    });
  });

  it('documents management tools in the registered-tools prompt when listed', () => {
    const port = makePort();
    const toolSpecs = [
      createPiviMcpTool(port),
      createPiviSkillsTool(port),
      createPiviCommandsTool(port),
    ];
    const section = buildRegisteredToolsSection({
      obsidianTools: toolSpecs.map((tool) => tool.name),
      toolSpecs,
      obsidianCliAvailable: true,
      includeMcp: false,
      includeSkill: false,
      includeSubagent: false,
      includeWebSearch: false,
    });

    expect(section).toContain('`pivi_mcp`');
    expect(section).toContain('list|test|upsert|set_enabled|remove');
    expect(section).toContain('never pass raw secrets');
    expect(section).toContain('`pivi_skills`');
    expect(section).toContain('list|list_remote|install|set_enabled|update|update_all|remove');
    expect(section).toContain('never supply Skill bodies');
    expect(section).toContain('`pivi_commands`');
    expect(section).toContain('catalogRevision');
    expect(section).toContain('beforeId');
  });
});
