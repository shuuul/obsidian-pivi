import piviIconSvg from '../../../../assets/icons/pivi-p.svg';

const PIVI_ICON_DATA_URI = `data:image/svg+xml,${encodeURIComponent(piviIconSvg)}`;

export interface PiviBrandIconProps {
  readonly className: string;
  readonly height?: number;
  readonly width?: number;
}

/** Pivi's bundled brand asset, shared by every React-owned brand-icon surface. */
export function PiviBrandIcon({ className, height, width }: PiviBrandIconProps) {
  return (
    <img
      alt=""
      aria-hidden="true"
      className={className}
      height={height}
      src={PIVI_ICON_DATA_URI}
      width={width}
    />
  );
}
