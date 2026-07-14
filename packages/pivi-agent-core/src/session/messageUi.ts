export interface SanitizedMessageUi<T> {
  sanitized: T;
  externalContextPaths?: string[];
}

/** Remove device-local absolute paths before a message UI payload reaches JSONL. */
export function sanitizeMessageUiForJsonl<T extends { turnRequest?: unknown }>(
  value: T,
): SanitizedMessageUi<T> {
  const request = value.turnRequest;
  if (!request || typeof request !== 'object' || Array.isArray(request)) {
    return { sanitized: value };
  }
  const requestRecord = request as Record<string, unknown>;
  if (!Object.hasOwn(requestRecord, 'externalContextPaths')) {
    return { sanitized: value };
  }

  const externalContextPaths = Array.isArray(requestRecord.externalContextPaths)
    ? requestRecord.externalContextPaths.filter((path): path is string => typeof path === 'string')
    : [];
  const sanitizedRequest = { ...requestRecord };
  Reflect.deleteProperty(sanitizedRequest, 'externalContextPaths');
  return {
    sanitized: { ...value, turnRequest: sanitizedRequest },
    externalContextPaths,
  };
}
