import {
  type PresentationPlatform,
  PresentationPlatformProvider,
} from '@pivi/pivi-react';
import { createElement, type ReactNode } from 'react';

export const testPresentationPlatform: PresentationPlatform = {
  renderIcon(container, name) {
    container.dataset.testIcon = name;
  },
  attachTooltip(container, label) {
    container.title = label;
  },
};

export function withTestPresentationPlatform(children: ReactNode): ReactNode {
  return createElement(
    PresentationPlatformProvider,
    { children, platform: testPresentationPlatform },
  );
}
