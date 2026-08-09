import { isSecretLikeHeaderName, isSecretLikeKey } from '../../foundation/configValueSource';
import {
  assertMcpStdioExecutable,
  assertValidMcpServerName,
  validateMcpRemoteUrl,
} from '../../mcp/mcpValidation';
import type {
  AgentMcpBearerInput,
  AgentMcpOAuthInput,
  AgentMcpServerInput,
  AgentMcpValueInput,
  PiviCommandsInput,
  PiviMcpInput,
  PiviSkillsInput,
} from './types';

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requireNonEmptyString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${field} must be a non-empty string.`);
  }
  return value.trim();
}

function optionalString(value: unknown, field: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string') {
    throw new Error(`${field} must be a string.`);
  }
  return value;
}

function requireBoolean(value: unknown, field: string): boolean {
  if (typeof value !== 'boolean') {
    throw new Error(`${field} must be a boolean.`);
  }
  return value;
}

function requireStringArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || !value.every((item) => typeof item === 'string')) {
    throw new Error(`${field} must be an array of strings.`);
  }
  return value.map((item) => item.trim()).filter((item) => item.length > 0);
}

function assertOnlyKeys(
  record: Record<string, unknown>,
  allowed: readonly string[],
  label: string,
): void {
  const allowedKeys = new Set(allowed);
  const unknown = Object.keys(record).find((key) => !allowedKeys.has(key));
  if (unknown) {
    throw new Error(`${label} must not include unknown field "${unknown}".`);
  }
}

function requireSafeIdentity(value: unknown, field: string): string {
  const identity = requireNonEmptyString(value, field);
  if (identity === '.' || identity === '..' || identity.includes('/') || identity.includes('\\')) {
    throw new Error(`${field} must not contain path traversal or separators.`);
  }
  return identity;
}

/** Keys that must never appear on the tool-call root (secrets only nest under server). */
const MCP_UNSAFE_TOP_LEVEL_KEYS = [
  'bearerToken',
  'bearerTokenEnv',
  'clientSecret',
  'headers',
  'env',
  'token',
  'password',
  'apiKey',
  'api_key',
] as const;

const MCP_UNSAFE_SERVER_KEYS = [
  'bearerTokenEnv',
  'clientSecret',
  'token',
  'password',
  'apiKey',
  'api_key',
] as const;

function rejectUnsafeKeys(
  record: Record<string, unknown>,
  keys: readonly string[],
  label: string,
): void {
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(record, key)) {
      throw new Error(`${label} must not include unsafe field "${key}".`);
    }
  }
}

function parseAgentMcpValueInput(value: unknown, field: string): AgentMcpValueInput {
  if (!isRecord(value)) {
    throw new Error(`${field} must be an object value reference.`);
  }
  rejectUnsafeKeys(value, ['secret', 'secretId', 'token'], field);
  const source = value.source;
  if (source === 'plain') {
    assertOnlyKeys(value, ['source', 'value'], field);
    if (typeof value.value !== 'string') {
      throw new Error(`${field}.value must be a string for source plain.`);
    }
    return { source: 'plain', value: value.value };
  }
  if (source === 'systemEnvironment') {
    assertOnlyKeys(value, ['source', 'variable'], field);
    if (Object.prototype.hasOwnProperty.call(value, 'value')) {
      throw new Error(`${field} systemEnvironment must not include a value field.`);
    }
    return {
      source: 'systemEnvironment',
      variable: requireNonEmptyString(value.variable, `${field}.variable`),
    };
  }
  if (source === 'clear') {
    assertOnlyKeys(value, ['source'], field);
    if (Object.prototype.hasOwnProperty.call(value, 'value')) {
      throw new Error(`${field} clear must not include a value field.`);
    }
    return { source: 'clear' };
  }
  throw new Error(`${field}.source must be plain, systemEnvironment, or clear.`);
}

function parseAgentMcpValueMap(
  value: unknown,
  field: string,
  channel: 'header' | 'env',
): Record<string, AgentMcpValueInput> | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) {
    throw new Error(`${field} must be an object map.`);
  }
  const next: Record<string, AgentMcpValueInput> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (!key.trim()) {
      throw new Error(`${field} keys must be non-empty.`);
    }
    // Reject legacy plain string maps (would embed secrets / bypass source typing).
    if (typeof entry === 'string') {
      throw new Error(
        `${field}.${key} must be a structured value reference, not a raw string.`,
      );
    }
    const parsed = parseAgentMcpValueInput(entry, `${field}.${key}`);
    const secretLike = channel === 'header'
      ? isSecretLikeHeaderName(key)
      : isSecretLikeKey(key);
    if (secretLike && parsed.source === 'plain') {
      throw new Error(`${field}.${key} is secret-like and cannot accept a plaintext value.`);
    }
    next[key] = parsed;
  }
  return next;
}

function parseBearerInput(value: unknown): AgentMcpBearerInput | undefined {
  if (value === undefined) return undefined;
  if (typeof value === 'string') {
    throw new Error('bearerToken must not be a raw string secret.');
  }
  if (!isRecord(value)) {
    throw new Error('bearerToken must be an object value reference.');
  }
  rejectUnsafeKeys(value, ['value', 'token', 'secret', 'secretId'], 'bearerToken');
  if (value.source === 'systemEnvironment') {
    assertOnlyKeys(value, ['source', 'variable'], 'bearerToken');
    return {
      source: 'systemEnvironment',
      variable: requireNonEmptyString(value.variable, 'bearerToken.variable'),
    };
  }
  if (value.source === 'clear') {
    assertOnlyKeys(value, ['source'], 'bearerToken');
    return { source: 'clear' };
  }
  throw new Error('bearerToken.source must be systemEnvironment or clear.');
}

function parseOAuthInput(value: unknown): AgentMcpOAuthInput | false | undefined {
  if (value === undefined) return undefined;
  if (value === false) return false;
  if (!isRecord(value)) {
    throw new Error('oauth must be an object or false.');
  }
  rejectUnsafeKeys(value, ['clientSecret', 'secret', 'token'], 'oauth');
  assertOnlyKeys(value, ['grantType', 'clientId', 'scope', 'clearClientSecret'], 'oauth');
  const grantType = value.grantType;
  if (
    grantType !== undefined
    && grantType !== 'authorization_code'
    && grantType !== 'client_credentials'
  ) {
    throw new Error('oauth.grantType is invalid.');
  }
  const clearClientSecret = value.clearClientSecret;
  if (clearClientSecret !== undefined && typeof clearClientSecret !== 'boolean') {
    throw new Error('oauth.clearClientSecret must be a boolean.');
  }
  return {
    ...(grantType !== undefined ? { grantType } : {}),
    ...(Object.prototype.hasOwnProperty.call(value, 'clientId')
      ? { clientId: optionalString(value.clientId, 'oauth.clientId') }
      : {}),
    ...(Object.prototype.hasOwnProperty.call(value, 'scope')
      ? { scope: optionalString(value.scope, 'oauth.scope') }
      : {}),
    ...(clearClientSecret !== undefined ? { clearClientSecret } : {}),
  };
}

function parseServerInput(value: unknown): AgentMcpServerInput {
  if (!isRecord(value)) {
    throw new Error('server must be an object.');
  }
  rejectUnsafeKeys(value, MCP_UNSAFE_SERVER_KEYS, 'server');

  // Raw bearer string on server is never allowed.
  if (typeof value.bearerToken === 'string') {
    throw new Error('server.bearerToken must not be a raw string secret.');
  }

  const type = value.type;
  if (type === 'http' || type === 'sse') {
    assertOnlyKeys(value, [
      'type',
      'url',
      'headers',
      'enabled',
      'contextSaving',
      'disabledTools',
      'description',
      'auth',
      'oauth',
      'bearerToken',
    ], 'server');
    const auth = value.auth;
    if (auth !== undefined && auth !== 'none' && auth !== 'bearer' && auth !== 'oauth') {
      throw new Error('server.auth must be none, bearer, or oauth.');
    }
    return {
      type,
      url: validateMcpRemoteUrl(requireNonEmptyString(value.url, 'server.url')),
      headers: parseAgentMcpValueMap(value.headers, 'server.headers', 'header'),
      enabled: value.enabled === undefined ? undefined : requireBoolean(value.enabled, 'server.enabled'),
      contextSaving: value.contextSaving === undefined
        ? undefined
        : requireBoolean(value.contextSaving, 'server.contextSaving'),
      disabledTools: value.disabledTools === undefined
        ? undefined
        : requireStringArray(value.disabledTools, 'server.disabledTools'),
      description: optionalString(value.description, 'server.description'),
      auth: auth,
      oauth: parseOAuthInput(value.oauth),
      bearerToken: parseBearerInput(value.bearerToken),
    };
  }

  if (type !== undefined && type !== 'stdio') {
    throw new Error('server.type must be http, sse, or stdio.');
  }

  assertOnlyKeys(value, [
    'type',
    'command',
    'args',
    'env',
    'enabled',
    'contextSaving',
    'disabledTools',
    'description',
  ], 'server');

  return {
    type: type === 'stdio' ? 'stdio' : undefined,
    command: assertMcpStdioExecutable(requireNonEmptyString(value.command, 'server.command')),
    args: value.args === undefined ? undefined : requireStringArray(value.args, 'server.args'),
    env: parseAgentMcpValueMap(value.env, 'server.env', 'env'),
    enabled: value.enabled === undefined ? undefined : requireBoolean(value.enabled, 'server.enabled'),
    contextSaving: value.contextSaving === undefined
      ? undefined
      : requireBoolean(value.contextSaving, 'server.contextSaving'),
    disabledTools: value.disabledTools === undefined
      ? undefined
      : requireStringArray(value.disabledTools, 'server.disabledTools'),
    description: optionalString(value.description, 'server.description'),
  };
}

export function parsePiviMcpInput(raw: unknown): PiviMcpInput {
  if (!isRecord(raw)) {
    throw new Error('pivi_mcp params must be an object.');
  }
  rejectUnsafeKeys(raw, MCP_UNSAFE_TOP_LEVEL_KEYS, 'pivi_mcp');
  const action = raw.action;
  if (typeof action !== 'string') {
    throw new Error('pivi_mcp action is required.');
  }

  switch (action) {
    case 'list':
      assertOnlyKeys(raw, ['action'], 'pivi_mcp');
      return { action: 'list' };
    case 'test':
      assertOnlyKeys(raw, ['action', 'name'], 'pivi_mcp');
      return { action: 'test', name: assertValidMcpServerName(requireNonEmptyString(raw.name, 'name')) };
    case 'upsert':
      assertOnlyKeys(raw, ['action', 'name', 'server'], 'pivi_mcp');
      return {
        action: 'upsert',
        name: assertValidMcpServerName(requireNonEmptyString(raw.name, 'name')),
        server: parseServerInput(raw.server),
      };
    case 'set_enabled':
      assertOnlyKeys(raw, ['action', 'name', 'enabled'], 'pivi_mcp');
      return {
        action: 'set_enabled',
        name: assertValidMcpServerName(requireNonEmptyString(raw.name, 'name')),
        enabled: requireBoolean(raw.enabled, 'enabled'),
      };
    case 'remove':
      assertOnlyKeys(raw, ['action', 'name'], 'pivi_mcp');
      return { action: 'remove', name: assertValidMcpServerName(requireNonEmptyString(raw.name, 'name')) };
    default:
      throw new Error(`Unknown pivi_mcp action: ${action}`);
  }
}

const SKILLS_UNSAFE_KEYS = [
  'content',
  'files',
  'file',
  'body',
  'skillMd',
  'SKILL.md',
  'sourceTree',
  'source_tree',
  'destination',
  'dest',
  'publish',
  'tree',
] as const;

function requireRemoteSkillsSource(value: unknown): string {
  const source = requireNonEmptyString(value, 'source').trim();
  const normalized = source.replace(/\\/g, '/');
  const ownerRepo = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
  const remoteUrl = /^(?:https?:\/\/|git(?:\+https)?:\/\/|ssh:\/\/)[^\s]+$/i;
  const scpGit = /^git@[A-Za-z0-9.-]+:[^\s/]+\/[^\s]+$/i;

  if (
    source === '.' || source === '..'
    || /^file:/i.test(source)
    || /^(?:[A-Za-z]:[\\/]|[A-Za-z]:$|\\\\|\/)/.test(source)
    || normalized.startsWith('./') || normalized.startsWith('../')
    || normalized.split('/').includes('..')
    || (!ownerRepo.test(source) && !remoteUrl.test(source) && !scpGit.test(source))
  ) {
    throw new Error('pivi_skills source must be a supported remote package source, not a local filesystem path.');
  }
  return source;
}

export function parsePiviSkillsInput(raw: unknown): PiviSkillsInput {
  if (!isRecord(raw)) {
    throw new Error('pivi_skills params must be an object.');
  }
  rejectUnsafeKeys(raw, SKILLS_UNSAFE_KEYS, 'pivi_skills');
  const action = raw.action;
  if (typeof action !== 'string') {
    throw new Error('pivi_skills action is required.');
  }

  switch (action) {
    case 'list':
      assertOnlyKeys(raw, ['action'], 'pivi_skills');
      return { action: 'list' };
    case 'list_remote':
      assertOnlyKeys(raw, ['action', 'source'], 'pivi_skills');
      return { action: 'list_remote', source: requireRemoteSkillsSource(raw.source) };
    case 'install': {
      assertOnlyKeys(raw, ['action', 'source', 'skillNames'], 'pivi_skills');
      const skillNames = raw.skillNames === undefined
        ? undefined
        : requireStringArray(raw.skillNames, 'skillNames');
      return {
        action: 'install',
        source: requireRemoteSkillsSource(raw.source),
        skillNames,
      };
    }
    case 'set_enabled':
      assertOnlyKeys(raw, ['action', 'name', 'enabled'], 'pivi_skills');
      return {
        action: 'set_enabled',
        name: requireSafeIdentity(raw.name, 'name'),
        enabled: requireBoolean(raw.enabled, 'enabled'),
      };
    case 'update':
      assertOnlyKeys(raw, ['action', 'name'], 'pivi_skills');
      return { action: 'update', name: requireSafeIdentity(raw.name, 'name') };
    case 'update_all':
      assertOnlyKeys(raw, ['action'], 'pivi_skills');
      return { action: 'update_all' };
    case 'remove':
      assertOnlyKeys(raw, ['action', 'name'], 'pivi_skills');
      return { action: 'remove', name: requireSafeIdentity(raw.name, 'name') };
    default:
      throw new Error(`Unknown pivi_skills action: ${action}`);
  }
}

export function parsePiviCommandsInput(raw: unknown): PiviCommandsInput {
  if (!isRecord(raw)) {
    throw new Error('pivi_commands params must be an object.');
  }
  const action = raw.action;
  if (typeof action !== 'string') {
    throw new Error('pivi_commands action is required.');
  }

  switch (action) {
    case 'list':
      assertOnlyKeys(raw, ['action'], 'pivi_commands');
      return { action: 'list' };
    case 'get':
      assertOnlyKeys(raw, ['action', 'id'], 'pivi_commands');
      return { action: 'get', id: requireSafeIdentity(raw.id, 'id') };
    case 'upsert':
      assertOnlyKeys(raw, [
        'action', 'id', 'name', 'description', 'argumentHint', 'icon', 'content', 'catalogRevision',
      ], 'pivi_commands');
      if (typeof raw.catalogRevision !== 'number' || !Number.isFinite(raw.catalogRevision)) {
        throw new Error('catalogRevision must be a finite number.');
      }
      return {
        action: 'upsert',
        id: requireSafeIdentity(raw.id, 'id'),
        name: optionalString(raw.name, 'name'),
        description: optionalString(raw.description, 'description'),
        argumentHint: optionalString(raw.argumentHint, 'argumentHint'),
        icon: optionalString(raw.icon, 'icon'),
        content: typeof raw.content === 'string'
          ? raw.content
          : (() => {
            throw new Error('content must be a string.');
          })(),
        catalogRevision: raw.catalogRevision,
      };
    case 'remove':
      assertOnlyKeys(raw, ['action', 'id', 'catalogRevision'], 'pivi_commands');
      if (typeof raw.catalogRevision !== 'number' || !Number.isFinite(raw.catalogRevision)) {
        throw new Error('catalogRevision must be a finite number.');
      }
      return { action: 'remove', id: requireSafeIdentity(raw.id, 'id'), catalogRevision: raw.catalogRevision };
    case 'move': {
      assertOnlyKeys(raw, [
        'action', 'id', 'beforeId', 'afterId', 'catalogRevision',
      ], 'pivi_commands');
      const beforeId = optionalString(raw.beforeId, 'beforeId');
      const afterId = optionalString(raw.afterId, 'afterId');
      if ((beforeId === undefined) === (afterId === undefined)) {
        throw new Error('move requires exactly one of beforeId or afterId.');
      }
      if (typeof raw.catalogRevision !== 'number' || !Number.isFinite(raw.catalogRevision)) {
        throw new Error('catalogRevision must be a finite number.');
      }
      return {
        action: 'move',
        id: requireSafeIdentity(raw.id, 'id'),
        beforeId: beforeId === undefined ? undefined : requireSafeIdentity(beforeId, 'beforeId'),
        afterId: afterId === undefined ? undefined : requireSafeIdentity(afterId, 'afterId'),
        catalogRevision: raw.catalogRevision,
      };
    }
    default:
      throw new Error(`Unknown pivi_commands action: ${action}`);
  }
}
