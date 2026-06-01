/** In-memory approval rules for the current agent session (not persisted). */

import { getActionPattern, matchesRulePattern } from './ApprovalManager';

export interface SessionApprovalRule {
  toolName: string;
  pattern: string;
}

export class SessionApprovalRules {
  private rules: SessionApprovalRule[] = [];

  add(toolName: string, pattern: string): void {
    const trimmed = pattern.trim();
    if (!trimmed) {
      return;
    }
    this.rules.push({ toolName, pattern: trimmed });
  }

  matches(toolName: string, actionPattern: string | null): boolean {
    if (actionPattern === null) {
      return false;
    }
    return this.rules.some(
      (rule) =>
        rule.toolName === toolName
        && matchesRulePattern(toolName, actionPattern, rule.pattern),
    );
  }

  clear(): void {
    this.rules = [];
  }

  /** Record allow-always using the same pattern key used for matching. */
  recordAlwaysAllow(
    toolName: string,
    input: Record<string, unknown>,
    resolvedPattern: string | null,
  ): void {
    const pattern = resolvedPattern ?? getActionPattern(toolName, input);
    if (pattern !== null && pattern !== '') {
      this.add(toolName, pattern);
    }
  }
}
