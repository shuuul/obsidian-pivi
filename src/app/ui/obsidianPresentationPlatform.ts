import type { PresentationPlatform } from '@pivi/pivi-react';
import { setIcon, setTooltip } from 'obsidian';

export const obsidianPresentationPlatform: PresentationPlatform = {
  renderIcon(container, name) {
    setIcon(container, name);
  },
  attachTooltip(container, label, options) {
    setTooltip(container, label, options);
  },
};
