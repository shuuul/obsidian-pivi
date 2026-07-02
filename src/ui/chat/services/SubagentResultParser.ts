import { extractFinalResultFromSubagentJsonl } from '@pivi/session/subagentJsonl';
import type { TaskResultInterpreter } from '@pivi/tools';

import { extractFullOutputPath, readTrustedFullOutputFile } from './subagentOutput';

export function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

export function parseJsonRecord(value: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(value);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function parseJsonValue(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

export class SubagentResultParser {
  private taskResultInterpreter: TaskResultInterpreter;

  constructor(taskResultInterpreter: TaskResultInterpreter) {
    this.taskResultInterpreter = taskResultInterpreter;
  }

  public extractAgentId(result: string): string | null {
    const payload = this.unwrapTextPayload(result).trim();
    if (!payload) {
      return null;
    }

    const parsed = parseJsonRecord(payload);
    if (parsed) {
      if (this.hasTerminalTaskStatus(parsed)) {
        return null;
      }

      const directAgentId = this.extractAgentIdFromRecord(parsed);
      if (directAgentId) {
        return directAgentId;
      }

      const taskRecord = parsed.task;
      if (isRecord(taskRecord)) {
        return this.extractAgentIdFromRecord(taskRecord);
      }
    }

    const xmlStatus = this.taskResultInterpreter.extractTagValue(payload, 'retrieval_status')
      ?? this.taskResultInterpreter.extractTagValue(payload, 'status');
    if (this.isTerminalTaskStatusValue(xmlStatus)) {
      return null;
    }

    const exactLineMatch = payload.match(/^\s*(?:agent_id|agentId)\s*[=:]\s*"?([a-zA-Z0-9_-]+)"?\s*$/i);
    return exactLineMatch?.[1] ?? null;
  }

  public hasTerminalTaskStatus(value: unknown): boolean {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return false;
    }

    const record = value as Record<string, unknown>;
    const rawStatus = record.retrieval_status ?? record.status;
    return this.isTerminalTaskStatusValue(rawStatus);
  }

  public isTerminalTaskStatusValue(rawStatus: unknown): boolean {
    if (typeof rawStatus !== 'string') {
      return false;
    }

    const normalized = rawStatus.toLowerCase();
    return normalized === 'completed' || normalized === 'success' || normalized === 'error';
  }

  public extractAgentIdFromRecord(record: Record<string, unknown>): string | null {
    const direct = record.agent_id ?? record.agentId;
    if (typeof direct === 'string' && direct.length > 0) {
      return direct;
    }

    const data = record.data;
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      return null;
    }

    const nested = (data as Record<string, unknown>).agent_id ?? (data as Record<string, unknown>).agentId;
    return typeof nested === 'string' && nested.length > 0 ? nested : null;
  }

  public extractAgentIdFromString(value: string): string | null {
    const regexPatterns = [
      /"agent_id"\s*:\s*"([^"]+)"/,
      /"agentId"\s*:\s*"([^"]+)"/,
      /agent_id[=:]\s*"?([a-zA-Z0-9_-]+)"?/i,
      /agentId[=:]\s*"?([a-zA-Z0-9_-]+)"?/i,
    ];

    for (const pattern of regexPatterns) {
      const match = value.match(pattern);
      if (match && match[1]) {
        return match[1];
      }
    }

    return null;
  }

  public isStillRunningResult(result: string, isError: boolean): boolean {
    const trimmed = result?.trim() || '';
    const payload = this.unwrapTextPayload(trimmed);

    if (isError) return false;
    if (!trimmed) return false;

    const parsed = parseJsonRecord(payload);
    if (parsed) {
      const status = parsed.retrieval_status ?? parsed.status;
      const agents = isRecord(parsed.agents) ? parsed.agents : null;
      const hasAgents = agents !== null && Object.keys(agents).length > 0;

      if (status === 'not_ready' || status === 'running' || status === 'pending') {
        return true;
      }

      if (hasAgents && agents) {
        const agentStatuses = Object.values(agents)
          .map((agent) => (isRecord(agent) && typeof agent.status === 'string') ? agent.status.toLowerCase() : '');
        const anyRunning = agentStatuses.some(s =>
          s === 'running' || s === 'pending' || s === 'not_ready'
        );
        if (anyRunning) return true;
        return false;
      }

      if (status === 'success' || status === 'completed') {
        return false;
      }

      return false;
    }

    const lowerResult = payload.toLowerCase();
    if (lowerResult.includes('not_ready') || lowerResult.includes('not ready')) {
      return true;
    }

    const xmlStatusMatch = lowerResult.match(/<status>([^<]+)<\/status>/);
    if (xmlStatusMatch) {
      const status = xmlStatusMatch[1].trim();
      if (status === 'running' || status === 'pending' || status === 'not_ready') {
        return true;
      }
    }

    return false;
  }

  public extractAgentResult(result: string, agentId: string, toolUseResult?: unknown): string {
    const structuredResult = this.taskResultInterpreter.extractStructuredResult(toolUseResult);
    const normalizedStructuredResult = this.extractResultFromCandidateString(structuredResult);
    if (normalizedStructuredResult) {
      return normalizedStructuredResult;
    }
    if (structuredResult) {
      return structuredResult;
    }

    const payload = this.unwrapTextPayload(result);

    const parsed = parseJsonRecord(payload);
    if (parsed) {
      const taskResult = this.extractResultFromTaskObject(parsed.task);
      if (taskResult) {
        return taskResult;
      }

      const agents = isRecord(parsed.agents) ? parsed.agents : null;
      const agentData = agents && agentId ? agents[agentId] : null;
      if (isRecord(agentData)) {
        const parsedResult = this.extractResultFromCandidateString(agentData.result);
        if (parsedResult) {
          return parsedResult;
        }
        const parsedOutput = this.extractResultFromCandidateString(agentData.output);
        if (parsedOutput) {
          return parsedOutput;
        }
        return JSON.stringify(agentData, null, 2);
      }

      if (agents) {
        const agentIds = Object.keys(agents);
        if (agentIds.length > 0) {
          const firstAgent = agents[agentIds[0]];
          if (isRecord(firstAgent)) {
            const parsedResult = this.extractResultFromCandidateString(firstAgent.result);
            if (parsedResult) {
              return parsedResult;
            }
            const parsedOutput = this.extractResultFromCandidateString(firstAgent.output);
            if (parsedOutput) {
              return parsedOutput;
            }
          }
          return JSON.stringify(firstAgent, null, 2);
        }
      }

      const parsedResult = this.extractResultFromCandidateString(parsed.result);
      if (parsedResult) {
        return parsedResult;
      }

      const parsedOutput = this.extractResultFromCandidateString(parsed.output);
      if (parsedOutput) {
        return parsedOutput;
      }
    }

    const taggedResult = this.extractResultFromTaggedPayload(payload);
    if (taggedResult) {
      return taggedResult;
    }

    return payload;
  }

  public extractResultFromTaskObject(task: unknown): string | null {
    if (!task || typeof task !== 'object') {
      return null;
    }
    const taskRecord = task as Record<string, unknown>;
    return this.extractResultFromCandidateString(taskRecord.result)
      ?? this.extractResultFromCandidateString(taskRecord.output);
  }

  public extractResultFromCandidateString(candidate: unknown): string | null {
    if (typeof candidate !== 'string') {
      return null;
    }

    const trimmed = candidate.trim();
    if (!trimmed) {
      return null;
    }

    const taggedResult = this.extractResultFromTaggedPayload(trimmed);
    if (taggedResult) {
      return taggedResult;
    }

    const jsonlResult = this.extractResultFromOutputJsonl(trimmed);
    if (jsonlResult) {
      return jsonlResult;
    }

    return trimmed;
  }

  public parseAgentId(result: string): string | null {
    const regexPatterns = [
      /"agent_id"\s*:\s*"([^"]+)"/,
      /"agentId"\s*:\s*"([^"]+)"/,
      /agent_id[=:]\s*"?([a-zA-Z0-9_-]+)"?/i,
      /agentId[=:]\s*"?([a-zA-Z0-9_-]+)"?/i,
      /\b([a-f0-9]{8})\b/,
    ];

    for (const pattern of regexPatterns) {
      const match = result.match(pattern);
      if (match && match[1]) {
        return match[1];
      }
    }

    const parsed = parseJsonRecord(result);
    if (parsed) {
      const agentId = parsed.agent_id || parsed.agentId;

      if (typeof agentId === 'string' && agentId.length > 0) {
        return agentId;
      }

      const data = parsed.data;
      if (isRecord(data) && typeof data.agent_id === 'string') {
        return data.agent_id;
      }

      if (parsed.id && typeof parsed.id === 'string') {
        return parsed.id;
      }
    }

    return null;
  }

  public inferAgentIdFromResult(result: string): string | null {
    const parsed = parseJsonRecord(result);
    if (parsed) {
      const agents = isRecord(parsed.agents) ? parsed.agents : null;
      if (agents) {
        return Object.keys(agents)[0] ?? null;
      }
    }
    return null;
  }

  public unwrapTextPayload(raw: string): string {
    const parsed = parseJsonValue(raw);
    if (parsed !== null) {
      if (Array.isArray(parsed)) {
        const textBlock = (parsed as unknown[]).find((block) => isRecord(block) && typeof block.text === 'string');
        if (isRecord(textBlock) && typeof textBlock.text === 'string') return textBlock.text;
      } else if (isRecord(parsed) && typeof parsed.text === 'string') {
        return parsed.text;
      }
    }
    return raw;
  }

  public extractResultFromTaggedPayload(payload: string): string | null {
    const directResult = this.taskResultInterpreter.extractTagValue(payload, 'result');
    if (directResult) return directResult;

    const outputContent = this.taskResultInterpreter.extractTagValue(payload, 'output');
    if (!outputContent) return null;

    const extractedFromJsonl = this.extractResultFromOutputJsonl(outputContent);
    if (extractedFromJsonl) return extractedFromJsonl;

    const nestedResult = this.taskResultInterpreter.extractTagValue(outputContent, 'result');
    if (nestedResult) return nestedResult;

    const trimmed = outputContent.trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  public extractResultFromOutputJsonl(outputContent: string): string | null {
    const inlineResult = extractFinalResultFromSubagentJsonl(outputContent);
    if (inlineResult) {
      return inlineResult;
    }

    const fullOutputPath = extractFullOutputPath(outputContent);
    if (!fullOutputPath) {
      return null;
    }

    const fullOutput = readTrustedFullOutputFile(fullOutputPath);
    if (!fullOutput) {
      return null;
    }

    return extractFinalResultFromSubagentJsonl(fullOutput);
  }

  public extractAgentIdFromInput(input: Record<string, unknown>): string | null {
    const agentId = (input.task_id as string) || (input.agentId as string) || (input.agent_id as string);
    return agentId || null;
  }
}
