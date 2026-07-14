import type { ChatIconSvg, ChatSvgChild } from '@pivi/pivi-agent-core/foundation';
import { useId } from 'react';

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
  const generatedId = useId().replace(/:/g, '');
  if (!icon) return null;
  if (icon.kind === 'pivi-brand') {
    const maskId = `pivi-brand-cutout-${generatedId}`;
    return (
      <svg aria-hidden="true" className="pivi-brand-icon" fill="none" viewBox="0 0 100 100">
        <defs>
          <mask id={maskId}>
            <rect fill="black" height="100" width="100" />
            <rect fill="white" height="72" rx="9" width="18" x="23" y="14" />
            <g transform="rotate(18 56 35)">
              <ellipse cx="56" cy="35" fill="white" rx="31" ry="25" />
            </g>
            <g transform="rotate(-20 58 36)">
              <ellipse cx="58" cy="36" fill="black" rx="14" ry="11" />
            </g>
          </mask>
        </defs>
        <rect fill="currentColor" height="100" mask={`url(#${maskId})`} width="100" />
      </svg>
    );
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
