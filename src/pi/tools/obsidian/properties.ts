import type { AgentTool } from '@earendil-works/pi-agent-core';

import { TOOL_OBSIDIAN_PROPERTIES } from '../../../core/tools/obsidianToolNames';
import { textResult } from '../toolResult';
import { requireApproval } from './approval';
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

export function createPropertiesTool(deps: ObsidianToolDeps): AgentTool {
  const { cli, vaultName, approve } = deps;
  return {
    name: TOOL_OBSIDIAN_PROPERTIES,
    label: 'Properties',
    description: 'Read or set frontmatter properties via Obsidian CLI only (requires cliEnabled). Not available through vault API.',
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
      await requireApproval(approve, TOOL_OBSIDIAN_PROPERTIES, input);
      const action = getPropertiesAction(input.action);
      const file = getStringField(input, 'file');
      const notePath = getStringField(input, 'path');
      const propName = getStringField(input, 'name');
      const propValue = getStringField(input, 'value');

      if (action === 'list') {
        const args = ['properties', 'format=json'];
        if (file) {
          args.push(`file=${file}`);
        }
        if (notePath) {
          args.push(`path=${JSON.stringify(notePath)}`);
        }
        return textResult(await cli.run({ vaultName, args }));
      }
      if (action === 'read' && propName) {
        const args = ['property:read', `name=${propName}`, 'format=json'];
        if (file) {
          args.push(`file=${file}`);
        }
        if (notePath) {
          args.push(`path=${JSON.stringify(notePath)}`);
        }
        return textResult(await cli.run({ vaultName, args }));
      }
      if (action === 'set' && propName && propValue !== undefined) {
        const args = [
          'property:set',
          `name=${propName}`,
          `value=${JSON.stringify(propValue)}`,
        ];
        if (file) {
          args.push(`file=${file}`);
        }
        if (notePath) {
          args.push(`path=${JSON.stringify(notePath)}`);
        }
        return textResult(await cli.run({ vaultName, args }));
      }
      if (action === 'set' && propName) {
        throw new Error('Invalid properties input: value must be a string for set.');
      }
      if (action === 'remove' && propName) {
        const args = ['property:remove', `name=${propName}`];
        if (file) {
          args.push(`file=${file}`);
        }
        if (notePath) {
          args.push(`path=${JSON.stringify(notePath)}`);
        }
        return textResult(await cli.run({ vaultName, args }));
      }
      throw new Error('Invalid properties action or missing name.');
    },
  };
}
