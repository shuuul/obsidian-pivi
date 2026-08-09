export interface ExternalContextPlatform {
  expandPath(value: string): string;
  normalizePath(value: string): string;
  normalizeForComparison(value: string): string;
  isAbsolute(value: string): boolean;
  homeDirectory(): string | null;
  validateDirectory(value: string): { valid: boolean; error?: string };
}

const unavailablePlatform: ExternalContextPlatform = {
  expandPath: value => value,
  normalizePath: value => value.replace(/\\/g, '/').replace(/\/+$/, ''),
  normalizeForComparison: value => value.replace(/\\/g, '/').replace(/\/+$/, ''),
  isAbsolute: () => false,
  homeDirectory: () => null,
  validateDirectory: () => ({ valid: false, error: 'External folders are unavailable on this device' }),
};

let platform: ExternalContextPlatform = unavailablePlatform;

export function configureExternalContextPlatform(next: ExternalContextPlatform | null): void {
  platform = next ?? unavailablePlatform;
}

export function getExternalContextPlatform(): ExternalContextPlatform {
  return platform;
}
