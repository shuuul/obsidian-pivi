import type { AgentRuntimeSettings, EnvironmentScope } from "../../pi/types/settings";
import { isAgentRuntimeSettings } from "../../pi/types/settings";

export interface EnvironmentScopeUpdate {
  scope: EnvironmentScope;
  envText: string;
}

type EnvironmentKeyOwnership =
  | { type: "shared-known" }
  | { type: "shared-unknown" }
  | { type: "agent" };

interface ClassifiedEnvironmentLines {
  shared: string[];
  agent: string[];
  reviewKeys: Set<string>;
}

const SHARED_ENVIRONMENT_KEYS = new Set([
  "PATH",
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "NO_PROXY",
  "ALL_PROXY",
  "SSL_CERT_FILE",
  "SSL_CERT_DIR",
  "REQUESTS_CA_BUNDLE",
  "CURL_CA_BUNDLE",
  "NODE_EXTRA_CA_CERTS",
  "TMPDIR",
  "TMP",
  "TEMP",
]);

const PI_ENVIRONMENT_KEY_PATTERNS: RegExp[] = [/^PI_/i];

/** Maps persisted snippet scopes from the old multi-provider layout. */
export function normalizeEnvironmentScope(
  value: unknown,
): EnvironmentScope | undefined {
  if (value === "shared" || value === "agent") {
    return value;
  }
  if (value === "pi" || value === "provider:pi") {
    return "agent";
  }
  return undefined;
}

function classifyEnvironmentKey(key: string): EnvironmentKeyOwnership {
  const normalized = key.trim().toUpperCase();
  if (!normalized) {
    return { type: "shared-unknown" };
  }

  if (SHARED_ENVIRONMENT_KEYS.has(normalized)) {
    return { type: "shared-known" };
  }

  if (PI_ENVIRONMENT_KEY_PATTERNS.some((pattern) => pattern.test(normalized))) {
    return { type: "agent" };
  }

  return { type: "shared-unknown" };
}

function extractEnvironmentKey(line: string): string | null {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) {
    return null;
  }

  const normalized = trimmed.startsWith("export ") ? trimmed.slice(7) : trimmed;
  const eqIndex = normalized.indexOf("=");
  if (eqIndex <= 0) {
    return null;
  }

  const key = normalized.slice(0, eqIndex).trim();
  return key || null;
}

function appendLines(
  target: string[],
  pendingDecorators: string[],
  line: string,
): void {
  target.push(...pendingDecorators, line);
}

function createClassifiedEnvironmentLines(): ClassifiedEnvironmentLines {
  return {
    shared: [],
    agent: [],
    reviewKeys: new Set<string>(),
  };
}

function joinEnvironmentLines(lines: string[]): string {
  return lines.join("\n");
}

function hasMeaningfulEnvironmentContent(envText: string): boolean {
  return envText.split(/\r?\n/).some((line) => {
    const trimmed = line.trim();
    return trimmed.length > 0 && !trimmed.startsWith("#");
  });
}

function getLegacyEnvironmentClassification(
  settings: Record<string, unknown>,
): ReturnType<typeof classifyEnvironmentVariablesByOwnership> {
  const legacyEnvironmentVariables = settings.environmentVariables;
  if (
    typeof legacyEnvironmentVariables !== "string" ||
    legacyEnvironmentVariables.length === 0
  ) {
    return {
      shared: "",
      agent: "",
      reviewKeys: [],
    };
  }

  return classifyEnvironmentVariablesByOwnership(legacyEnvironmentVariables);
}

export function classifyEnvironmentVariablesByOwnership(input: string): {
  shared: string;
  agent: string;
  reviewKeys: string[];
} {
  const result = createClassifiedEnvironmentLines();
  let pendingDecorators: string[] = [];

  for (const line of input.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      pendingDecorators.push(line);
      continue;
    }

    const key = extractEnvironmentKey(line);
    if (!key) {
      appendLines(result.shared, pendingDecorators, line);
      pendingDecorators = [];
      continue;
    }

    const ownership = classifyEnvironmentKey(key);
    if (ownership.type === "agent") {
      appendLines(result.agent, pendingDecorators, line);
    } else {
      appendLines(result.shared, pendingDecorators, line);
      if (ownership.type === "shared-unknown") {
        result.reviewKeys.add(key);
      }
    }
    pendingDecorators = [];
  }

  if (pendingDecorators.length > 0) {
    result.shared.push(...pendingDecorators);
  }

  return {
    shared: joinEnvironmentLines(result.shared),
    agent: joinEnvironmentLines(result.agent),
    reviewKeys: Array.from(result.reviewKeys),
  };
}

export function getSharedEnvironmentVariables(
  settings: Record<string, unknown>,
): string {
  const sharedEnvironmentVariables = settings.sharedEnvironmentVariables;
  if (typeof sharedEnvironmentVariables === "string") {
    return sharedEnvironmentVariables;
  }

  return getLegacyEnvironmentClassification(settings).shared;
}

export function setSharedEnvironmentVariables(
  settings: Record<string, unknown>,
  envText: string,
): void {
  settings.sharedEnvironmentVariables = envText;
  delete settings.environmentVariables;
}

function readAgentSettingsRecord(
  settings: Record<string, unknown>,
): AgentRuntimeSettings | null {
  const candidate = settings.agentSettings;
  if (isAgentRuntimeSettings(candidate)) {
    return candidate;
  }
  return null;
}

function ensureAgentSettings(
  settings: Record<string, unknown>,
): AgentRuntimeSettings {
  const current = readAgentSettingsRecord(settings);
  if (current) {
    return current;
  }

  const next: AgentRuntimeSettings = {
    environmentVariables: "",
    selectedMode: "default",
    visibleModels: [],
  };
  settings.agentSettings = next;
  return next;
}

export function getAgentEnvironmentVariables(
  settings: Record<string, unknown>,
): string {
  const agentSettings = readAgentSettingsRecord(settings);
  if (agentSettings && typeof agentSettings.environmentVariables === "string") {
    return agentSettings.environmentVariables;
  }

  return getLegacyEnvironmentClassification(settings).agent;
}

export function setAgentEnvironmentVariables(
  settings: Record<string, unknown>,
  envText: string,
): void {
  const agentSettings = ensureAgentSettings(settings);
  agentSettings.environmentVariables = envText;
  delete settings.environmentVariables;
}

export function joinEnvironmentTexts(
  ...parts: Array<string | undefined>
): string {
  const filtered = parts.filter(
    (part): part is string => typeof part === "string" && part.length > 0,
  );
  if (filtered.length === 0) {
    return "";
  }

  return filtered.reduce((combined, part) => {
    if (!combined) {
      return part;
    }

    return combined.endsWith("\n")
      ? `${combined}${part}`
      : `${combined}\n${part}`;
  }, "");
}

export function getRuntimeEnvironmentText(
  settings: Record<string, unknown>,
): string {
  return joinEnvironmentTexts(
    getSharedEnvironmentVariables(settings),
    getAgentEnvironmentVariables(settings),
  );
}

export function getEnvironmentVariablesForScope(
  settings: Record<string, unknown>,
  scope: EnvironmentScope,
): string {
  if (scope === "shared") {
    return getSharedEnvironmentVariables(settings);
  }

  return getAgentEnvironmentVariables(settings);
}

export function setEnvironmentVariablesForScope(
  settings: Record<string, unknown>,
  scope: EnvironmentScope,
  envText: string,
): void {
  if (scope === "shared") {
    setSharedEnvironmentVariables(settings, envText);
    return;
  }

  setAgentEnvironmentVariables(settings, envText);
}

export function getEnvironmentReviewKeysForScope(
  envText: string,
  scope: EnvironmentScope,
): string[] {
  const reviewKeys = new Set<string>();

  for (const line of envText.split(/\r?\n/)) {
    const key = extractEnvironmentKey(line);
    if (!key || reviewKeys.has(key)) {
      continue;
    }

    const ownership = classifyEnvironmentKey(key);
    if (scope === "shared") {
      if (ownership.type !== "shared-known") {
        reviewKeys.add(key);
      }
      continue;
    }

    if (ownership.type !== "agent") {
      reviewKeys.add(key);
    }
  }

  return Array.from(reviewKeys);
}

export function inferEnvironmentSnippetScope(
  envText: string,
): EnvironmentScope | undefined {
  const classified = classifyEnvironmentVariablesByOwnership(envText);
  const nonEmptyScopes: EnvironmentScope[] = [];

  if (hasMeaningfulEnvironmentContent(classified.shared)) {
    nonEmptyScopes.push("shared");
  }

  if (hasMeaningfulEnvironmentContent(classified.agent)) {
    nonEmptyScopes.push("agent");
  }

  return nonEmptyScopes.length === 1 ? nonEmptyScopes[0] : undefined;
}

export function resolveEnvironmentSnippetScope(
  envText: string,
  fallbackScope?: EnvironmentScope,
): EnvironmentScope | undefined {
  const inferredScope = inferEnvironmentSnippetScope(envText);
  if (inferredScope) {
    return inferredScope;
  }

  return hasMeaningfulEnvironmentContent(envText) ? undefined : fallbackScope;
}

export function getEnvironmentScopeUpdates(
  envText: string,
  fallbackScope?: EnvironmentScope,
): EnvironmentScopeUpdate[] {
  const classified = classifyEnvironmentVariablesByOwnership(envText);
  const updates: EnvironmentScopeUpdate[] = [];

  if (classified.shared.trim()) {
    updates.push({ scope: "shared", envText: classified.shared });
  }

  if (classified.agent.trim()) {
    updates.push({ scope: "agent", envText: classified.agent });
  }

  if (updates.length > 0) {
    return updates;
  }

  if (fallbackScope) {
    return [{ scope: fallbackScope, envText }];
  }

  return [];
}
