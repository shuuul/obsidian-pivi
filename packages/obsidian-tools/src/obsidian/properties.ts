import {
  capToolResultText,
  textResult,
  TOOL_OBSIDIAN_PROPERTIES,
  type ToolSpec,
} from '@pivi/agent/tools';

import type { ObsidianToolDeps } from './deps';

type PropertiesAction = 'list' | 'read' | 'set' | 'remove' | 'aliases';
type PropertyType = 'text' | 'list' | 'number' | 'checkbox' | 'date' | 'datetime';
const VALID_PROPERTY_TYPES: readonly PropertyType[] = ['text', 'list', 'number', 'checkbox', 'date', 'datetime'];

function getStringField(input: Record<string, unknown>, key: string): string | undefined {
  const value = input[key];
  return typeof value === 'string' ? value : undefined;
}

function getBooleanField(input: Record<string, unknown>, key: string): boolean | undefined {
  const value = input[key];
  return typeof value === 'boolean' ? value : undefined;
}

function getPropertiesAction(value: unknown): PropertiesAction | undefined {
  return value === 'list' || value === 'read' || value === 'set' || value === 'remove' || value === 'aliases'
    ? value
    : undefined;
}

function getPropertyType(value: unknown): PropertyType | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value === 'string' && (VALID_PROPERTY_TYPES as readonly string[]).includes(value)) {
    return value as PropertyType;
  }
  throw new Error('Invalid property type: must be text, list, number, checkbox, date, or datetime.');
}

function getSortField(value: unknown): 'name' | 'count' {
  if (value === undefined || value === 'name') {
    return 'name';
  }
  if (value === 'count') {
    return 'count';
  }
  throw new Error('Invalid properties sort: must be name or count.');
}

function coercePropertyValue(raw: unknown, type: PropertyType | undefined): unknown {
  if (raw === undefined) {
    throw new Error('Invalid properties input: value is required for set.');
  }
  if (type === undefined || type === 'text' || type === 'date' || type === 'datetime') {
    if (typeof raw !== 'string') {
      throw new Error('Invalid properties input: value must be a string for set.');
    }
    return raw;
  }
  if (type === 'number') {
    if (typeof raw === 'number' && Number.isFinite(raw)) {
      return raw;
    }
    if (typeof raw === 'string' && raw.trim() && Number.isFinite(Number(raw))) {
      return Number(raw);
    }
    throw new Error('Invalid properties input: value must be a number for type=number.');
  }
  if (type === 'checkbox') {
    if (typeof raw === 'boolean') {
      return raw;
    }
    if (raw === 'true' || raw === 'false') {
      return raw === 'true';
    }
    throw new Error('Invalid properties input: value must be a boolean for type=checkbox.');
  }
  if (Array.isArray(raw)) {
    if (raw.every((item) => typeof item === 'string')) {
      return raw;
    }
    throw new Error('Invalid properties input: list values must be strings.');
  }
  if (typeof raw === 'string') {
    return raw.split(',').map((item) => item.trim()).filter(Boolean);
  }
  throw new Error('Invalid properties input: value must be a string or string array for type=list.');
}

export function createPropertiesTool(deps: ObsidianToolDeps): ToolSpec {
  const { vault } = deps;
  return {
    name: TOOL_OBSIDIAN_PROPERTIES,
    label: 'Properties',
    description: 'List, read, set, or remove frontmatter properties via Obsidian FileManager.processFrontMatter and MetadataCache. aliases lists note aliases. Results are capped at 50,000 characters; narrow to file/path or omit verbose if truncated.',
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['list', 'read', 'set', 'remove', 'aliases'] },
        name: { type: 'string' },
        value: {
          description: 'Property value for set. String for text/date; number, boolean, or comma-separated list according to type.',
        },
        type: {
          type: 'string',
          enum: [...VALID_PROPERTY_TYPES],
          description: 'Property type for set (default text).',
        },
        file: { type: 'string' },
        path: { type: 'string' },
        active: { type: 'boolean', description: 'Limit list/aliases/read to the active file.' },
        sort: { type: 'string', enum: ['name', 'count'], description: 'Vault-wide list sort (default name).' },
        verbose: { type: 'boolean', description: 'aliases: include file paths for vault-wide results.' },
      },
      required: ['action'],
      additionalProperties: false,
    },
    async execute(_id, params) {
      const input = params as Record<string, unknown>;
      const action = getPropertiesAction(input.action);
      const file = getStringField(input, 'file');
      const notePath = getStringField(input, 'path');
      const propName = getStringField(input, 'name');
      const active = getBooleanField(input, 'active');

      if (action === 'list') {
        const result = vault.getProperties(file, notePath, propName, {
          active,
          sort: getSortField(input.sort),
        });
        return textResult(capToolResultText(JSON.stringify(result, null, 2)), { action, total: result.total });
      }
      if (action === 'aliases') {
        const result = vault.getAliases(file, notePath, {
          active,
          verbose: getBooleanField(input, 'verbose'),
        });
        return textResult(capToolResultText(JSON.stringify(result, null, 2)), { action, total: result.total });
      }
      if (action === 'read' && propName) {
        const result = vault.getProperties(file, notePath, propName, { active });
        return textResult(capToolResultText(JSON.stringify(result, null, 2)), { action, name: propName });
      }
      if (action === 'set' && propName) {
        const type = getPropertyType(input.type);
        const value = coercePropertyValue(input.value, type);
        const result = await vault.setProperty(file, notePath, propName, value);
        return textResult(`Set property ${propName} in ${result.path}`, { ...result, type });
      }
      if (action === 'remove' && propName) {
        const result = await vault.removeProperty(file, notePath, propName);
        return textResult(`Removed property ${propName} from ${result.path}`, { ...result });
      }
      throw new Error('Invalid properties action or missing name.');
    },
  };
}
