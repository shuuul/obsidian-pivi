import { type CSSProperties, useId } from 'react';

import piviIconSvg from '../../../../assets/icons/pivi-p.svg';

export interface PiviBrandIconProps {
  readonly className: string;
  readonly height?: number;
  readonly width?: number;
}

/** Pivi's bundled brand asset, shared by every React-owned brand-icon surface. */
export function PiviBrandIcon({ className, height, width }: PiviBrandIconProps) {
  const maskId = `pivi-bowl-cutout-${useId().replace(/:/g, '')}`;
  const iconSvg = piviIconSvg.replaceAll('pivi-bowl-cutout', maskId);
  const style: CSSProperties = { height, width };
  return (
    <span
      aria-hidden="true"
      className={className}
      dangerouslySetInnerHTML={{ __html: iconSvg }}
      style={style}
    />
  );
}
