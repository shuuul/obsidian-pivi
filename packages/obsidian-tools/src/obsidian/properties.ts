import {
  textResult,
  TOOL_OBSIDIAN_PROPERTIES,
  type ToolSpec,
} from '@pivi/pivi-agent-core/tools';

import type { ObsidianToolDeps } from './deps';

type PropertiesAction = 'list' | 'read' | 'set' | 'remove';

function getStringField(input: Record<string, unknown>, key: string): string | undefined {
  const value = input[key];
  return typeof value === 'string' ? value : undefined;
}

function getPropertiesAction(value: unknown): PropertiesAction | undefined {
  return value === 'list' || value === 'read' || value === 'set' || value === 'remove'
    ? value
    : undefined;
}

export function createPropertiesTool(deps: ObsidianToolDeps): ToolSpec {
  const { vault } = deps;
  return {
    name: TOOL_OBSIDIAN_PROPERTIES,
    label: 'Properties',
    description: 'List, read, set, or remove frontmatter properties via Obsidian FileManager.processFrontMatter and MetadataCache.',
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['list', 'read', 'set', 'remove'] },
        name: { type: 'string' },
        value: { type: 'string' },
        file: { type: 'string' },
        path: { type: 'string' },
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
      const propValue = getStringField(input, 'value');

      if (action === 'list') {
        const result = vault.getProperties(file, notePath);
        return textResult(JSON.stringify(result, null, 2), { action });
      }
      if (action === 'read' && propName) {
        const result = vault.getProperties(file, notePath, propName);
        return textResult(JSON.stringify(result, null, 2), { action, name: propName });
      }
      if (action === 'set' && propName && propValue !== undefined) {
        const result = await vault.setProperty(file, notePath, propName, propValue);
        return textResult(`Set property ${propName} in ${result.path}`, { ...result });
      }
      if (action === 'set' && propName) {
        throw new Error('Invalid properties input: value must be a string for set.');
      }
      if (action === 'remove' && propName) {
        const result = await vault.removeProperty(file, notePath, propName);
        return textResult(`Removed property ${propName} from ${result.path}`, { ...result });
      }
      throw new Error('Invalid properties action or missing name.');
    },
  };
}
