type DebugLogger = ((...args: unknown[]) => void) & {
  enabled: boolean;
  namespace: string;
  extend(namespace: string): DebugLogger;
};

function createDebug(namespace = ''): DebugLogger {
  const logger = (() => {}) as DebugLogger;
  logger.enabled = false;
  logger.namespace = namespace;
  logger.extend = (childNamespace: string) => createDebug(namespace ? `${namespace}:${childNamespace}` : childNamespace);
  return logger;
}

createDebug.enable = (_namespaces: string): void => {};
createDebug.disable = (): string => '';
createDebug.enabled = (_namespace: string): boolean => false;
createDebug.names = [] as RegExp[];
createDebug.skips = [] as RegExp[];
createDebug.formatters = {} as Record<string, (value: unknown) => string>;

export const enable = createDebug.enable;
export const disable = createDebug.disable;
export const enabled = createDebug.enabled;
export const names = createDebug.names;
export const skips = createDebug.skips;
export const formatters = createDebug.formatters;

export default createDebug;
