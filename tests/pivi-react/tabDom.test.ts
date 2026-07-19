import type { App } from 'obsidian';

import { buildTabDOM } from '@/ui/chat/tabs/tabDom';

describe('chat tab DOM', () => {
  it('mounts the queued-turn portal inside the chat bottom controls', () => {
    const contentEl = document.createElement('div');
    const dom = buildTabDOM(contentEl, {} as App);

    expect(dom.queuePortalEl.parentElement).toBe(dom.messagesBottomControlsEl);
    expect(dom.queuePortalEl.closest('.pivi-messages-wrapper')).toBe(dom.messagesWrapperEl);
    expect(dom.queuePortalEl.closest('.pivi-input-container')).toBeNull();

    dom.richInput.destroy();
  });
});
