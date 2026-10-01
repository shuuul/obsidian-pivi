import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import * as mock from '@earendil-works/pi-ai';

/**
 * Pivi's engine reads and rewrites the transcript system messages that carry
 * the system prompt and tool declarations. Jest maps pi-ai to a mock and does
 * not transform its ESM dist, so the installed helpers run in a child Node
 * process and the mock must agree with them on the shapes the engine uses.
 */
describe('Pi transcript system-message contract', () => {
  const read = { name: 'read', description: 'Read', parameters: { type: 'object' } };
  const search = { name: 'search', description: 'Search', parameters: { type: 'object' } };
  const user = { role: 'user', content: 'hi', timestamp: 1 };
  const delta = { role: 'system', content: '', toolsAdded: [search], toolsRemoved: [read], timestamp: 2 };

  function evaluate(helpers: typeof mock): unknown {
    const initial = helpers.createInitialSystemMessage('prompt', [read] as never);
    const normalized = helpers.normalizeContext({ systemPrompt: 'prompt', tools: [read], messages: [user] } as never);
    const messages = [initial, user, delta] as never[];
    return {
      initial,
      empty: helpers.createInitialSystemMessage(undefined, undefined) ?? null,
      normalized,
      leading: helpers.getInitialSystemMessage(messages) ?? null,
      noLeading: helpers.getInitialSystemMessage([user] as never[]) ?? null,
      rest: helpers.withoutInitialSystemMessage(messages),
      tools: helpers.getCurrentTools(messages),
      prompt: helpers.getCurrentSystemPrompt([initial, user] as never[]),
    };
  }

  function evaluateInstalled(): unknown {
    const moduleUrl = pathToFileURL(
      join(process.cwd(), 'node_modules', '@earendil-works', 'pi-ai', 'dist', 'utils', 'transcript.js'),
    ).href;
    const script = `
      const helpers = await import(${JSON.stringify(moduleUrl)});
      const read = ${JSON.stringify(read)};
      const search = ${JSON.stringify(search)};
      const user = ${JSON.stringify(user)};
      const delta = ${JSON.stringify(delta)};
      const evaluate = ${evaluate.toString()};
      process.stdout.write(JSON.stringify(evaluate(helpers)));
    `;
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], { encoding: 'utf8' });
    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
    return JSON.parse(result.stdout);
  }

  it('declares the prompt and tools on one leading system message', () => {
    const installed = evaluateInstalled() as Record<string, unknown>;

    expect(installed.initial).toEqual({ role: 'system', content: 'prompt', toolsAdded: [read], timestamp: 0 });
    expect(installed.normalized).toEqual({ messages: [installed.initial, user] });
    expect(installed.tools).toEqual([search]);
    expect(installed.prompt).toBe('prompt');
  });

  it('keeps the Jest pi-ai mock aligned with the installed helpers', () => {
    expect(JSON.parse(JSON.stringify(evaluate(mock)))).toEqual(evaluateInstalled());
  });
});
