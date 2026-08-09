/** JSON Schema fragments for pivi_* management tools (spec 040). */

const STRING = { type: 'string' } as const;
const BOOLEAN = { type: 'boolean' } as const;
const STRING_ARRAY = { type: 'array', items: STRING } as const;

const AGENT_MCP_VALUE_INPUT = {
  oneOf: [
    {
      type: 'object',
      properties: {
        source: { type: 'string', const: 'plain' },
        value: STRING,
      },
      required: ['source', 'value'],
      additionalProperties: false,
    },
    {
      type: 'object',
      properties: {
        source: { type: 'string', const: 'systemEnvironment' },
        variable: STRING,
      },
      required: ['source', 'variable'],
      additionalProperties: false,
    },
    {
      type: 'object',
      properties: {
        source: { type: 'string', const: 'clear' },
      },
      required: ['source'],
      additionalProperties: false,
    },
  ],
} as const;

const AGENT_MCP_BEARER_INPUT = {
  oneOf: [
    {
      type: 'object',
      properties: {
        source: { type: 'string', const: 'systemEnvironment' },
        variable: STRING,
      },
      required: ['source', 'variable'],
      additionalProperties: false,
    },
    {
      type: 'object',
      properties: {
        source: { type: 'string', const: 'clear' },
      },
      required: ['source'],
      additionalProperties: false,
    },
  ],
} as const;

const AGENT_MCP_OAUTH_INPUT = {
  oneOf: [
    {
      type: 'object',
      properties: {
        grantType: {
          type: 'string',
          enum: ['authorization_code', 'client_credentials'],
        },
        clientId: STRING,
        scope: STRING,
        clearClientSecret: BOOLEAN,
      },
      additionalProperties: false,
    },
    { type: 'boolean', const: false },
  ],
} as const;

const AGENT_MCP_VALUE_MAP = {
  type: 'object',
  additionalProperties: AGENT_MCP_VALUE_INPUT,
} as const;

const AGENT_MCP_REMOTE_SERVER = {
  type: 'object',
  properties: {
    type: { type: 'string', enum: ['http', 'sse'] },
    url: STRING,
    headers: AGENT_MCP_VALUE_MAP,
    enabled: BOOLEAN,
    contextSaving: BOOLEAN,
    disabledTools: STRING_ARRAY,
    description: STRING,
    auth: { type: 'string', enum: ['none', 'bearer', 'oauth'] },
    oauth: AGENT_MCP_OAUTH_INPUT,
    bearerToken: AGENT_MCP_BEARER_INPUT,
  },
  required: ['type', 'url'],
  additionalProperties: false,
} as const;

const AGENT_MCP_STDIO_SERVER = {
  type: 'object',
  properties: {
    type: { type: 'string', const: 'stdio' },
    command: STRING,
    args: STRING_ARRAY,
    env: AGENT_MCP_VALUE_MAP,
    enabled: BOOLEAN,
    contextSaving: BOOLEAN,
    disabledTools: STRING_ARRAY,
    description: STRING,
  },
  required: ['command'],
  additionalProperties: false,
} as const;

const AGENT_MCP_SERVER = {
  oneOf: [AGENT_MCP_REMOTE_SERVER, AGENT_MCP_STDIO_SERVER],
} as const;

export const PIVI_MCP_PARAMETERS = {
  oneOf: [
    {
      type: 'object',
      properties: { action: { type: 'string', const: 'list' } },
      required: ['action'],
      additionalProperties: false,
    },
    {
      type: 'object',
      properties: {
        action: { type: 'string', const: 'test' },
        name: STRING,
      },
      required: ['action', 'name'],
      additionalProperties: false,
    },
    {
      type: 'object',
      properties: {
        action: { type: 'string', const: 'upsert' },
        name: STRING,
        server: AGENT_MCP_SERVER,
      },
      required: ['action', 'name', 'server'],
      additionalProperties: false,
    },
    {
      type: 'object',
      properties: {
        action: { type: 'string', const: 'set_enabled' },
        name: STRING,
        enabled: BOOLEAN,
      },
      required: ['action', 'name', 'enabled'],
      additionalProperties: false,
    },
    {
      type: 'object',
      properties: {
        action: { type: 'string', const: 'remove' },
        name: STRING,
      },
      required: ['action', 'name'],
      additionalProperties: false,
    },
  ],
} as const;

export const PIVI_SKILLS_PARAMETERS = {
  oneOf: [
    {
      type: 'object',
      properties: { action: { type: 'string', const: 'list' } },
      required: ['action'],
      additionalProperties: false,
    },
    {
      type: 'object',
      properties: {
        action: { type: 'string', const: 'list_remote' },
        source: STRING,
      },
      required: ['action', 'source'],
      additionalProperties: false,
    },
    {
      type: 'object',
      properties: {
        action: { type: 'string', const: 'install' },
        source: STRING,
        skillNames: STRING_ARRAY,
      },
      required: ['action', 'source'],
      additionalProperties: false,
    },
    {
      type: 'object',
      properties: {
        action: { type: 'string', const: 'set_enabled' },
        name: STRING,
        enabled: BOOLEAN,
      },
      required: ['action', 'name', 'enabled'],
      additionalProperties: false,
    },
    {
      type: 'object',
      properties: {
        action: { type: 'string', const: 'update' },
        name: STRING,
      },
      required: ['action', 'name'],
      additionalProperties: false,
    },
    {
      type: 'object',
      properties: { action: { type: 'string', const: 'update_all' } },
      required: ['action'],
      additionalProperties: false,
    },
    {
      type: 'object',
      properties: {
        action: { type: 'string', const: 'remove' },
        name: STRING,
      },
      required: ['action', 'name'],
      additionalProperties: false,
    },
  ],
} as const;

export const PIVI_COMMANDS_PARAMETERS = {
  oneOf: [
    {
      type: 'object',
      properties: { action: { type: 'string', const: 'list' } },
      required: ['action'],
      additionalProperties: false,
    },
    {
      type: 'object',
      properties: {
        action: { type: 'string', const: 'get' },
        id: STRING,
      },
      required: ['action', 'id'],
      additionalProperties: false,
    },
    {
      type: 'object',
      properties: {
        action: { type: 'string', const: 'upsert' },
        id: STRING,
        name: STRING,
        description: STRING,
        argumentHint: STRING,
        icon: STRING,
        content: STRING,
        catalogRevision: { type: 'number' },
      },
      required: ['action', 'id', 'content', 'catalogRevision'],
      additionalProperties: false,
    },
    {
      type: 'object',
      properties: {
        action: { type: 'string', const: 'remove' },
        id: STRING,
        catalogRevision: { type: 'number' },
      },
      required: ['action', 'id', 'catalogRevision'],
      additionalProperties: false,
    },
    {
      type: 'object',
      properties: {
        action: { type: 'string', const: 'move' },
        id: STRING,
        beforeId: STRING,
        afterId: STRING,
        catalogRevision: { type: 'number' },
      },
      required: ['action', 'id', 'catalogRevision'],
      oneOf: [
        { required: ['beforeId'], not: { required: ['afterId'] } },
        { required: ['afterId'], not: { required: ['beforeId'] } },
      ],
      additionalProperties: false,
    },
  ],
} as const;
