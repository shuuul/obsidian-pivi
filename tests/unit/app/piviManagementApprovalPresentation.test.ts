import { createI18n, SUPPORTED_LOCALES, type TFunction } from '@pivi/pivi-react';
import type { McpManagementPlan } from '@pivi/agent/mcp/mcpManagementCoordinator';
import type { SkillsManagementPlan } from '@pivi/agent/skills/vault/skillsManagementCoordinator';

import {
  presentCommandsManagementApproval,
  presentMcpManagementApproval,
  presentPromptManagementApproval,
  presentSkillsManagementApproval,
} from '@/app/piviManagementApprovalPresentation';

const PREFIX = 'translated:';

function deterministicTranslator(): TFunction {
  return ((key: string, params?: Record<string, string | number>) =>
    `${PREFIX}${key}${params ? `:${JSON.stringify(params)}` : ''}`) as TFunction;
}

function expectTranslatedRequest(
  request: ReturnType<typeof presentMcpManagementApproval>,
  expected: { domain: string; action: string; values: unknown[] },
): void {
  expect(request).toMatchObject({ domain: expected.domain, action: expected.action });
  expect(request.title.startsWith(PREFIX)).toBe(true);
  expect(request.changeLines).toHaveLength(1);
  expect(request.changeLines?.[0]?.startsWith(PREFIX)).toBe(true);
  if (expected.values.length === 0) {
    expect(request.fields).toBeUndefined();
    return;
  }
  expect(request.fields?.every(field => field.label.startsWith(PREFIX))).toBe(true);
  expect(request.fields?.map(field => field.value)).toEqual(expected.values);
}

describe('pivi management approval presentation', () => {
  const t = deterministicTranslator();

  it.each([
    {
      name: 'upsert HTTP',
      plan: { revision: 'm1', mutation: { action: 'upsert', name: 'remote', server: {
        type: 'http', url: 'https://example.test/a/very/long/path?optional=true', auth: 'bearer',
        headers: { Z_HEADER: { source: 'clear' }, A_HEADER: { source: 'plain', value: 'visible' } },
        bearerToken: { source: 'systemEnvironment', variable: 'MCP_TOKEN' },
        oauth: { grantType: 'client_credentials', clientId: 'client', scope: 'read write', clearClientSecret: true },
        enabled: false, contextSaving: true, disabledTools: ['optional-long-tool-name'],
      } } },
      action: 'upsert',
      values: ['remote', 'http', 'https://example.test/a/very/long/path?optional=true', 'bearer',
        ['A_HEADER', 'Z_HEADER'], 'env:MCP_TOKEN', 'client_credentials', 'client', 'read write',
        `${PREFIX}chat.piviManagementApproval.management.values.clear`,
        `${PREFIX}chat.piviManagementApproval.management.values.no`,
        `${PREFIX}chat.piviManagementApproval.management.values.yes`, ['optional-long-tool-name']],
    },
    {
      name: 'upsert SSE',
      plan: { revision: 'm2', mutation: { action: 'upsert', name: 'events', server: {
        type: 'sse', url: 'https://events.example.test/sse', enabled: true,
      } } },
      action: 'upsert',
      values: ['events', 'sse', 'https://events.example.test/sse',
        `${PREFIX}chat.piviManagementApproval.management.values.yes`],
    },
    {
      name: 'enable',
      plan: { revision: 'm3', mutation: { action: 'set_enabled', name: 'server', enabled: true } },
      action: 'set_enabled',
      values: ['server', `${PREFIX}chat.piviManagementApproval.management.values.yes`],
    },
    {
      name: 'disable',
      plan: { revision: 'm4', mutation: { action: 'set_enabled', name: 'server', enabled: false } },
      action: 'set_enabled',
      values: ['server', `${PREFIX}chat.piviManagementApproval.management.values.no`],
    },
    {
      name: 'remove',
      plan: { revision: 'm5', mutation: { action: 'remove', name: 'server' } },
      action: 'remove', values: ['server'],
    },
  ] as const)('translates MCP $name presentation and exposes only normalized values', ({ plan, action, values }) => {
    expect(plan.mutation.action).toBe(action);
    expectTranslatedRequest(presentMcpManagementApproval(plan as McpManagementPlan, t), {
      domain: 'mcp', action, values: [...values],
    });
  });

  it.each([
    {
      name: 'install',
      plan: { revision: 's1', mutation: { action: 'install',
        source: 'github:example/repository/tree/main/a/long/optional/source', skillNames: ['alpha', 'beta'] } },
      values: ['github:example/repository/tree/main/a/long/optional/source', ['alpha', 'beta']],
    },
    { name: 'enable', plan: { revision: 's2', mutation: { action: 'set_enabled', name: 'skill', enabled: true } },
      values: ['skill', `${PREFIX}chat.piviManagementApproval.management.values.yes`] },
    { name: 'disable', plan: { revision: 's3', mutation: { action: 'set_enabled', name: 'skill', enabled: false } },
      values: ['skill', `${PREFIX}chat.piviManagementApproval.management.values.no`] },
    { name: 'update', plan: { revision: 's4', mutation: { action: 'update', name: 'skill' } }, values: ['skill'] },
    { name: 'update_all', plan: { revision: 's5', mutation: { action: 'update_all' } }, values: [] },
    { name: 'remove', plan: { revision: 's6', mutation: { action: 'remove', name: 'skill' } }, values: ['skill'] },
  ] as const)('translates Skills $name presentation and exposes only normalized values', ({ plan, values }) => {
    expect(plan.mutation.action).toBeDefined();
    expectTranslatedRequest(presentSkillsManagementApproval(plan as SkillsManagementPlan, t), {
      domain: 'skills', action: plan.mutation.action, values: [...values],
    });
  });

  it.each([
    {
      name: 'upsert',
      mutation: { action: 'upsert', id: 'summarize', catalogRevision: 9, content: 'AGENT CONTENT',
        description: 'AGENT DESCRIPTION', argumentHint: 'AGENT HINT', icon: 'file-text' },
      values: ['/summarize', 9, 'file-text', `${PREFIX}chat.piviManagementApproval.management.values.updated`],
    },
    { name: 'remove', mutation: { action: 'remove', id: 'summarize', catalogRevision: 10 },
      values: ['/summarize', 10] },
    { name: 'move before', mutation: { action: 'move', id: 'summarize', catalogRevision: 11, beforeId: 'review' },
      values: ['/summarize', 11, '/review'] },
    { name: 'move after', mutation: { action: 'move', id: 'summarize', catalogRevision: 12, afterId: 'draft' },
      values: ['/summarize', 12, '/draft'] },
  ] as const)('translates Commands $name presentation and exposes only normalized values', ({ mutation, values }) => {
    const request = presentCommandsManagementApproval({ revision: mutation.catalogRevision, mutation }, t);
    expectTranslatedRequest(request, { domain: 'commands', action: mutation.action, values: [...values] });
    expect(JSON.stringify(request)).not.toMatch(/AGENT (?:CONTENT|DESCRIPTION|HINT)/u);
  });

  it.each([
    {
      name: 'enable',
      mutation: { action: 'set_enabled', id: 'transcript-cleanup', enabled: true, catalogRevision: 4 },
      values: ['transcript-cleanup', 4, `${PREFIX}chat.piviManagementApproval.management.values.yes`],
    },
    {
      name: 'set body',
      mutation: { action: 'set_body', id: 'transcript-cleanup', body: 'AGENT MODULE BODY', catalogRevision: 5 },
      values: ['transcript-cleanup', 5, `${PREFIX}chat.piviManagementApproval.management.values.updated`],
    },
    {
      name: 'create',
      mutation: { action: 'upsert', title: 'Research', body: 'AGENT MODULE BODY', catalogRevision: 6 },
      values: ['Research', 6, 'Research', `${PREFIX}chat.piviManagementApproval.management.values.updated`],
    },
    {
      name: 'move after',
      mutation: { action: 'move', id: 'custom:a', catalogRevision: 7, afterId: 'custom:b' },
      values: ['custom:a', 7, 'custom:b'],
    },
  ] as const)('translates Prompt $name presentation without echoing bodies', ({ mutation, values }) => {
    const request = presentPromptManagementApproval({ revision: mutation.catalogRevision, mutation }, t);
    expectTranslatedRequest(request, { domain: 'prompt', action: mutation.action, values: [...values] });
    expect(JSON.stringify(request)).not.toContain('AGENT MODULE BODY');
  });

  it('resolves representative approval keys from every supported locale catalog', () => {
    const representativeKeys = [
      'chat.piviManagementApproval.management.titles.mcp.upsert',
      'chat.piviManagementApproval.management.titles.skills.install',
      'chat.piviManagementApproval.management.titles.commands.move',
      'chat.piviManagementApproval.management.titles.prompt.create',
      'chat.piviManagementApproval.management.changes.mcpDisable',
      'chat.piviManagementApproval.management.fields.catalogRevision',
      'chat.piviManagementApproval.management.values.yes',
    ] as const;

    for (const { code } of SUPPORTED_LOCALES) {
      const i18n = createI18n(code);
      for (const key of representativeKeys) {
        expect(i18n.t(key, { name: 'n', source: 's', command: '/c' })).not.toBe(key);
      }
    }
  });
});
