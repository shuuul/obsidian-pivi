import type {
  ChatProjectionDiagnosticCode,
  ChatProjectionDiagnosticListener,
  ChatProjectionEvent,
} from './chatProjectionEvents';

/**
 * Ownership and ordering guard for the projection event plane. Each projection
 * scope has one active owner whose events must arrive in sequence; a run that
 * reached its terminal event accepts no further message mutations.
 */
export class ChatProjectionEventGate {
  private readonly activeOwnerByScope = new Map<string, string>();
  private readonly lastSequenceByOwner = new Map<string, number>();
  private readonly terminalRuns = new Set<string>();

  constructor(
    private readonly onDiagnostic: ChatProjectionDiagnosticListener,
    private readonly hasMessageOwner: (messageId: string) => boolean,
  ) {}

  markRunTerminal(event: ChatProjectionEvent): void {
    this.terminalRuns.add(this.runKey(this.ownerKey(event), event.runId));
  }

  clear(): void {
    this.activeOwnerByScope.clear();
    this.lastSequenceByOwner.clear();
    this.terminalRuns.clear();
  }

  /** Returns whether the event is in order and owned; rejected events are reported, not thrown. */
  accept(event: ChatProjectionEvent): boolean {
    const ownerKey = this.ownerKey(event);
    const activeOwner = this.activeOwnerByScope.get(event.projectionScopeId);
    if (activeOwner !== ownerKey) {
      if (event.sequence !== 1) {
        this.reportDiagnostic('missing-owner', event);
        return false;
      }
      if (activeOwner) this.clearOwnerState(activeOwner);
      this.activeOwnerByScope.set(event.projectionScopeId, ownerKey);
    }

    const lastSequence = this.lastSequenceByOwner.get(ownerKey) ?? 0;
    if (event.sequence === lastSequence) {
      this.reportDiagnostic('duplicate-sequence', event);
      return false;
    }
    if (event.sequence !== lastSequence + 1) {
      this.reportDiagnostic('out-of-order-sequence', event);
      return false;
    }
    this.lastSequenceByOwner.set(ownerKey, event.sequence);

    if (this.isMessageMutation(event)
      && this.terminalRuns.has(this.runKey(ownerKey, event.runId))) {
      this.reportDiagnostic('late-after-terminal', event);
      return false;
    }
    if (!this.hasEventOwner(event)) {
      this.reportDiagnostic('missing-owner', event);
      return false;
    }
    return true;
  }

  private isMessageMutation(event: ChatProjectionEvent): boolean {
    return event.type === 'message.upsert'
      || event.type === 'text.append'
      || event.type === 'tool.upsert'
      || event.type === 'agent.upsert';
  }

  private hasEventOwner(event: ChatProjectionEvent): boolean {
    if ((event.type === 'message.upsert'
      || event.type === 'text.append'
      || event.type === 'tool.upsert'
      || event.type === 'agent.upsert')
      && event.message.id !== event.messageId) {
      return false;
    }
    if (event.type === 'text.append') {
      if (!this.hasMessageOwner(event.messageId)) return false;
      const prefix = `${event.messageId}:block:`;
      const index = event.blockId.startsWith(prefix)
        ? Number(event.blockId.slice(prefix.length))
        : Number.NaN;
      const block = event.message.contentBlocks?.[index];
      return Number.isInteger(index) && (block?.type === 'text' || block?.type === 'thinking');
    }
    if (event.type === 'tool.upsert') {
      return event.tool.id === event.toolId
        && this.hasMessageOwner(event.messageId)
        && event.message.toolCalls?.some(tool => tool.id === event.toolId) === true;
    }
    if (event.type === 'agent.upsert') {
      const payloadAgentId = event.agent.agentId ?? event.agent.id;
      if (payloadAgentId !== event.agentId || !this.hasMessageOwner(event.messageId)) {
        return false;
      }
      return event.message.toolCalls?.some(tool => {
        const subagent = tool.subagent;
        return subagent?.id === event.agent.id
          && (subagent.agentId ?? subagent.id) === event.agentId;
      }) === true;
    }
    return true;
  }

  private ownerKey(event: ChatProjectionEvent): string {
    return `${event.projectionScopeId}\u0000${event.sessionFile ?? ''}\u0000${event.openSessionId ?? ''}`;
  }

  private runKey(ownerKey: string, runId: string): string {
    return `${ownerKey}\u0000${runId}`;
  }

  private clearOwnerState(ownerKey: string): void {
    this.lastSequenceByOwner.delete(ownerKey);
    const prefix = `${ownerKey}\u0000`;
    for (const runKey of this.terminalRuns) {
      if (runKey.startsWith(prefix)) this.terminalRuns.delete(runKey);
    }
  }

  private reportDiagnostic(
    code: ChatProjectionDiagnosticCode,
    event: ChatProjectionEvent,
  ): void {
    this.onDiagnostic({
      code,
      eventType: event.type,
      projectionScopeId: event.projectionScopeId,
      runId: event.runId,
      sequence: event.sequence,
      messageId: event.messageId,
      blockId: event.blockId,
      toolId: event.toolId,
      agentId: event.agentId,
    });
  }
}
