import type { ChatIconSvg, ChatSvgChild } from '@pivi/pivi-agent-core/foundation';

import { PiviBrandIcon } from './PiviBrandIcon';

function renderSvgChild(child: ChatSvgChild, key: number) {
  if (child.tag === 'g') {
    return (
      <g key={key} {...child.attributes}>
        {child.children.map((nested, index) => renderSvgChild(nested, index))}
      </g>
    );
  }
  return <path key={key} {...child.attributes} />;
}

export function ChatLogo({ icon }: { icon: ChatIconSvg | null }) {
  if (!icon) return null;
  if (icon.kind === 'pivi-brand') {
    return <PiviBrandIcon className="pivi-brand-icon" />;
  }
  return (
    <svg
      aria-hidden="true"
      className="pivi-brand-icon pivi-provider-icon"
      fill="none"
      height="18"
      viewBox={icon.viewBox}
      width="18"
    >
      {icon.kind === 'composite'
        ? icon.children.map((child, index) => renderSvgChild(child, index))
        : <path d={icon.path} fill="currentColor" />}
    </svg>
  );
}
