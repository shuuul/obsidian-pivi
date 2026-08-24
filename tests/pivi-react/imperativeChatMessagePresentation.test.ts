import type { MessageContentAdapterContext } from '@pivi/pivi-react';

import { createReplacingContentAdapter } from '@/app/ui/imperativeChatMessagePresentation';

function context(generation: string): MessageContentAdapterContext {
  const ownerWindow = document.defaultView;
  if (!ownerWindow) throw new Error('Expected jsdom owner window');
  return {
    generation,
    ownerDocument: document,
    ownerWindow,
  };
}

describe('createReplacingContentAdapter', () => {
  it('publishes only the latest completed async snapshot without remounting', async () => {
    const completions: Array<() => void> = [];
    const adapter = createReplacingContentAdapter<string>((target, value) => {
      target.textContent = value;
      return new Promise<void>(resolve => completions.push(resolve));
    });
    const container = document.createElement('div');
    const dispose = adapter.mount(container, 'initial', context('tool-1'));

    adapter.update(container, 'latest', context('tool-1'));
    expect(container).toBeEmptyDOMElement();

    completions[1]?.();
    await Promise.resolve();
    expect(container).toHaveTextContent('latest');

    completions[0]?.();
    await Promise.resolve();
    expect(container).toHaveTextContent('latest');

    dispose?.();
    expect(container).toBeEmptyDOMElement();
  });

  it('rejects updates that change the mounted entity identity', () => {
    const adapter = createReplacingContentAdapter<string>((target, value) => {
      target.textContent = value;
    });
    const container = document.createElement('div');
    adapter.mount(container, 'initial', context('tool-1'));

    expect(() => adapter.update(container, 'other', context('tool-2')))
      .toThrow('Imperative content identity changed from tool-1 to tool-2');
  });

  it('rejects updates outside the mounted lifecycle', () => {
    const adapter = createReplacingContentAdapter<string>(() => {});
    const container = document.createElement('div');

    expect(() => adapter.update(container, 'orphan', context('tool-1')))
      .toThrow('Imperative content tool-1 is not mounted');
  });
});
