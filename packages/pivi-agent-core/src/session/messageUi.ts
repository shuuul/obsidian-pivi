import { parseAgentReport } from './continuationSchemas';

export interface SanitizedMessageUi<T> {
  sanitized: T;
  externalContextPaths?: string[];
}

/** Remove device-local absolute paths before a message UI payload reaches JSONL. */
export function sanitizeMessageUiForJsonl<T extends { turnRequest?: unknown }>(
  value: T,
): SanitizedMessageUi<T> {
  const sanitizedToolCalls = sanitizeToolCallReports(
    (value as { toolCalls?: unknown }).toolCalls,
  );
  const baseValue = sanitizedToolCalls
    ? { ...value, toolCalls: sanitizedToolCalls }
    : value;
  const request = value.turnRequest;
  if (!request || typeof request !== 'object' || Array.isArray(request)) {
    return { sanitized: baseValue };
  }
  const requestRecord = request as Record<string, unknown>;
  if (!Object.hasOwn(requestRecord, 'externalContextPaths')) {
    return { sanitized: baseValue };
  }

  const externalContextPaths = Array.isArray(requestRecord.externalContextPaths)
    ? requestRecord.externalContextPaths.filter((path): path is string => typeof path === 'string')
    : [];
  const sanitizedRequest = { ...requestRecord };
  Reflect.deleteProperty(sanitizedRequest, 'externalContextPaths');
  return {
    sanitized: { ...baseValue, turnRequest: sanitizedRequest },
    externalContextPaths,
  };
}

function sanitizeToolCallReports(value: unknown): unknown[] | null {
  if (!Array.isArray(value)) {
    return null;
  }
  const toolCalls = value as unknown[];
  return toolCalls.map((toolCall: unknown): unknown => {
    if (!toolCall || typeof toolCall !== 'object' || Array.isArray(toolCall)) {
      return toolCall;
    }
    const toolCallRecord = toolCall as Record<string, unknown>;
    const details = toolCallRecord.toolUseResult;
    if (!details || typeof details !== 'object' || Array.isArray(details)) {
      return toolCall;
    }
    const detailsRecord = details as Record<string, unknown>;
    if (!Object.hasOwn(detailsRecord, 'agent_report')) {
      return toolCall;
    }
    const agentReport = parseAgentReport(detailsRecord.agent_report);
    const nextDetails = { ...detailsRecord };
    if (agentReport) {
      nextDetails.agent_report = agentReport;
    } else {
      Reflect.deleteProperty(nextDetails, 'agent_report');
    }
    return { ...toolCallRecord, toolUseResult: nextDetails };
  });
}
