import type { KeyboardEvent, MouseEvent, PointerEvent, ReactNode } from 'react';

export function SettingsInlineActions({
  children,
  className = '',
  isolate = true,
}: {
  readonly children: ReactNode;
  readonly className?: string;
  readonly isolate?: boolean;
}) {
  return (
    <span
      className={`pivi-settings-actions${className ? ` ${className}` : ''}`}
      {...(isolate ? {
        'data-toolbar-control': true,
        onClick: (event: MouseEvent<HTMLSpanElement>) => { event.stopPropagation(); },
        onPointerDown: (event: PointerEvent<HTMLSpanElement>) => { event.stopPropagation(); },
        onPointerMove: (event: PointerEvent<HTMLSpanElement>) => { event.stopPropagation(); },
        onKeyDown: (event: KeyboardEvent<HTMLSpanElement>) => { event.stopPropagation(); },
        onKeyUp: (event: KeyboardEvent<HTMLSpanElement>) => { event.stopPropagation(); },
      } : {})}
    >
      {children}
    </span>
  );
}
