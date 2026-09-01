import {
  IDENTITY_PROMPT_MODULE_ID,
  isShippedPromptModuleId,
  SHIPPED_PROMPT_MODULES,
} from './registry';
import type {
  ComposedPromptSections,
  CustomPromptModule,
  PromptModuleOverride,
  PromptModuleSettings,
  ResolvedPromptModule,
} from './types';

const TOOL_IDENTIFIER_PATTERN = /\b(?:obsidian_[a-z0-9_]+|pivi_[a-z0-9_]+|spawn_agent)\b/g;

export function filterUnavailableToolGuidance(
  prompt: string,
  registeredToolNames?: readonly string[],
): string {
  if (!registeredToolNames) return prompt;
  const registered = new Set(registeredToolNames);
  return prompt.split('\n').filter((line) => {
    const mentioned = line.match(TOOL_IDENTIFIER_PATTERN) ?? [];
    return mentioned.every((name) => registered.has(name));
  }).join('\n');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function interpolateIdentityBody(defaultBody: string, userName?: string): string {
  const trimmedUserName = userName?.trim();
  if (!trimmedUserName) {
    return defaultBody;
  }
  return `## User Context\n\nYou are collaborating with **${trimmedUserName}**.\n\n${defaultBody}`;
}

function formatModuleSection(title: string, body: string): string {
  const trimmed = body.trim();
  if (!trimmed) {
    return '';
  }
  if (trimmed.startsWith('## ')) {
    return trimmed;
  }
  return `## ${title}\n\n${trimmed}`;
}

function joinSections(sections: readonly string[]): string {
  return sections.filter((section) => section.trim().length > 0).join('\n\n');
}

export function resolvePromptModules(
  overrides?: Readonly<Record<string, PromptModuleOverride>>,
  custom?: readonly CustomPromptModule[],
): ResolvedPromptModule[] {
  const resolved: ResolvedPromptModule[] = SHIPPED_PROMPT_MODULES.map((module) => {
    const override = overrides?.[module.id];
    const customBody = override?.customBody;
    const modified = customBody !== undefined;
    if (module.kind === 'core') {
      return {
        id: module.id,
        kind: module.kind,
        title: module.title,
        body: module.defaultBody,
        enabled: true,
        modified,
      };
    }
    return {
      id: module.id,
      kind: module.kind,
      title: module.title,
      body: customBody !== undefined ? customBody : module.defaultBody,
      enabled: override?.enabled ?? module.defaultEnabled,
      modified,
    };
  });

  for (const entry of custom ?? []) {
    if (!entry.id || isShippedPromptModuleId(entry.id)) {
      continue;
    }
    resolved.push({
      id: entry.id,
      kind: 'custom',
      title: entry.title,
      body: entry.body,
      enabled: entry.enabled,
      modified: false,
    });
  }

  return resolved;
}

export function composePromptSections(input: {
  readonly overrides?: Readonly<Record<string, PromptModuleOverride>>;
  readonly custom?: readonly CustomPromptModule[];
  readonly userName?: string;
  readonly registeredToolNames?: readonly string[];
} = {}): ComposedPromptSections {
  const resolved = resolvePromptModules(input.overrides, input.custom);
  const coreParts: string[] = [];
  const workflowParts: string[] = [];
  const customParts: string[] = [];

  for (const module of resolved) {
    if (!module.enabled) {
      continue;
    }
    const body = module.id === IDENTITY_PROMPT_MODULE_ID
      ? interpolateIdentityBody(module.body, input.userName)
      : module.body;
    const section = formatModuleSection(module.title, body);
    if (!section) {
      continue;
    }
    if (module.kind === 'core') {
      coreParts.push(section);
    } else if (module.kind === 'workflow') {
      workflowParts.push(section);
    } else {
      customParts.push(section);
    }
  }

  const core = filterUnavailableToolGuidance(
    joinSections(coreParts),
    input.registeredToolNames,
  );
  const workflow = filterUnavailableToolGuidance(
    joinSections(workflowParts),
    input.registeredToolNames,
  );
  const custom = filterUnavailableToolGuidance(
    joinSections(customParts),
    input.registeredToolNames,
  );
  return {
    core,
    workflow,
    custom,
    fullStatic: joinSections([core, workflow, custom]),
  };
}

function normalizeOverride(
  value: unknown,
): PromptModuleOverride | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const override: { enabled?: boolean; customBody?: string } = {};
  if (typeof value.enabled === 'boolean') {
    override.enabled = value.enabled;
  }
  if (typeof value.customBody === 'string') {
    override.customBody = value.customBody;
  }
  if (override.enabled === undefined && override.customBody === undefined) {
    return {};
  }
  return override;
}

function normalizeCustomEntry(value: unknown): CustomPromptModule | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const id = value.id;
  const title = value.title;
  const body = value.body;
  const enabled = value.enabled;
  if (typeof id !== 'string' || id.trim().length === 0) {
    return undefined;
  }
  if (isShippedPromptModuleId(id)) {
    return undefined;
  }
  if (typeof title !== 'string' || typeof body !== 'string' || typeof enabled !== 'boolean') {
    return undefined;
  }
  return { id, title, body, enabled };
}

export function normalizePromptModuleSettings(
  promptModules: unknown,
  customPromptModules: unknown,
): PromptModuleSettings {
  const normalizedOverrides: Record<string, PromptModuleOverride> = {};
  if (isRecord(promptModules)) {
    for (const [id, value] of Object.entries(promptModules)) {
      const override = normalizeOverride(value);
      if (override === undefined) {
        continue;
      }
      normalizedOverrides[id] = override;
    }
  }

  const normalizedCustom: CustomPromptModule[] = [];
  if (Array.isArray(customPromptModules)) {
    for (const entry of customPromptModules) {
      const custom = normalizeCustomEntry(entry);
      if (custom) {
        normalizedCustom.push(custom);
      }
    }
  }

  return {
    promptModules: normalizedOverrides,
    customPromptModules: normalizedCustom,
  };
}

export function computePromptCompositionKey(
  overrides?: Readonly<Record<string, PromptModuleOverride>>,
  custom?: readonly CustomPromptModule[],
): string | undefined {
  const hasOverrides = overrides !== undefined && Object.keys(overrides).length > 0;
  const hasCustom = custom !== undefined && custom.length > 0;
  if (!hasOverrides && !hasCustom) {
    return undefined;
  }

  const sortedOverrides = hasOverrides
    ? Object.keys(overrides).sort().map((id) => {
      const override = overrides[id] ?? {};
      return [id, override.enabled ?? null, override.customBody ?? null];
    })
    : [];
  const customPart = hasCustom
    ? custom.map((entry) => [entry.id, entry.enabled, entry.title, entry.body])
    : [];
  return JSON.stringify([sortedOverrides, customPart]);
}
