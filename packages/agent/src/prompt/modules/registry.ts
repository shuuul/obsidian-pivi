import {
  EXACT_MATCH_EDITING_DEFAULT_BODY,
  FILE_REFERENCES_DEFAULT_BODY,
  IDENTITY_DEFAULT_BODY,
  MARKDOWN_HYGIENE_DEFAULT_BODY,
  MUTATION_SAFETY_DEFAULT_BODY,
  OBSIDIAN_CONTEXT_DEFAULT_BODY,
  PATH_CONVENTIONS_DEFAULT_BODY,
  RESPONSE_LANGUAGE_DEFAULT_BODY,
  TOOL_RECOVERY_DEFAULT_BODY,
  USER_MESSAGE_FORMAT_DEFAULT_BODY,
} from './coreBodies';
import type { ShippedPromptModule } from './types';
import {
  DAILY_PERIODIC_NOTES_DEFAULT_BODY,
  FRONTMATTER_CONVENTIONS_DEFAULT_BODY,
  LONG_LINE_NORMALIZATION_DEFAULT_BODY,
  TRANSCRIPT_CLEANUP_DEFAULT_BODY,
  WIKILINK_CONVENTIONS_DEFAULT_BODY,
} from './workflowBodies';

export const CUSTOM_PROMPT_MODULE_ID_PREFIX = 'custom:';

export const IDENTITY_PROMPT_MODULE_ID = 'identity';

const SHIPPED_PROMPT_MODULE_LIST: readonly ShippedPromptModule[] = [
  {
    id: IDENTITY_PROMPT_MODULE_ID,
    kind: 'core',
    title: 'Identity & Role',
    defaultBody: IDENTITY_DEFAULT_BODY,
    defaultEnabled: true,
  },
  {
    id: 'response-language',
    kind: 'core',
    title: 'Response Language',
    defaultBody: RESPONSE_LANGUAGE_DEFAULT_BODY,
    defaultEnabled: true,
  },
  {
    id: 'path-conventions',
    kind: 'core',
    title: 'Path Conventions',
    defaultBody: PATH_CONVENTIONS_DEFAULT_BODY,
    defaultEnabled: true,
  },
  {
    id: 'user-message-format',
    kind: 'core',
    title: 'User Message Format',
    defaultBody: USER_MESSAGE_FORMAT_DEFAULT_BODY,
    defaultEnabled: true,
  },
  {
    id: 'obsidian-context',
    kind: 'core',
    title: 'Obsidian Context',
    defaultBody: OBSIDIAN_CONTEXT_DEFAULT_BODY,
    defaultEnabled: true,
  },
  {
    id: 'markdown-hygiene',
    kind: 'core',
    title: 'Obsidian Markdown Hygiene',
    defaultBody: MARKDOWN_HYGIENE_DEFAULT_BODY,
    defaultEnabled: true,
  },
  {
    id: 'mutation-safety',
    kind: 'core',
    title: 'Vault mutations (use the narrowest exact mutation)',
    defaultBody: MUTATION_SAFETY_DEFAULT_BODY,
    defaultEnabled: true,
  },
  {
    id: 'exact-match-editing',
    kind: 'core',
    title: 'Exact-match editing',
    defaultBody: EXACT_MATCH_EDITING_DEFAULT_BODY,
    defaultEnabled: true,
  },
  {
    id: 'tool-recovery',
    kind: 'core',
    title: 'Tool failure recovery',
    defaultBody: TOOL_RECOVERY_DEFAULT_BODY,
    defaultEnabled: true,
  },
  {
    id: 'file-references',
    kind: 'core',
    title: 'File References in Responses',
    defaultBody: FILE_REFERENCES_DEFAULT_BODY,
    defaultEnabled: true,
  },
  {
    id: 'long-line-normalization',
    kind: 'workflow',
    title: 'Long-line normalization',
    defaultBody: LONG_LINE_NORMALIZATION_DEFAULT_BODY,
    defaultEnabled: false,
  },
  {
    id: 'transcript-cleanup',
    kind: 'workflow',
    title: 'Transcript cleanup',
    defaultBody: TRANSCRIPT_CLEANUP_DEFAULT_BODY,
    defaultEnabled: true,
  },
  {
    id: 'wikilink-conventions',
    kind: 'workflow',
    title: 'Wikilink conventions',
    defaultBody: WIKILINK_CONVENTIONS_DEFAULT_BODY,
    defaultEnabled: true,
  },
  {
    id: 'frontmatter-conventions',
    kind: 'workflow',
    title: 'Frontmatter conventions',
    defaultBody: FRONTMATTER_CONVENTIONS_DEFAULT_BODY,
    defaultEnabled: true,
  },
  {
    id: 'daily-periodic-notes',
    kind: 'workflow',
    title: 'Daily / periodic notes',
    defaultBody: DAILY_PERIODIC_NOTES_DEFAULT_BODY,
    defaultEnabled: true,
  },
];

export const SHIPPED_PROMPT_MODULES: readonly ShippedPromptModule[] = Object.freeze(
  SHIPPED_PROMPT_MODULE_LIST.map((module) => Object.freeze({ ...module })),
);

const SHIPPED_PROMPT_MODULES_BY_ID = new Map(
  SHIPPED_PROMPT_MODULES.map((module) => [module.id, module]),
);

export function getShippedPromptModule(id: string): ShippedPromptModule | undefined {
  return SHIPPED_PROMPT_MODULES_BY_ID.get(id);
}

export function isShippedPromptModuleId(id: string): boolean {
  return SHIPPED_PROMPT_MODULES_BY_ID.has(id);
}

export function createCustomPromptModuleId(): string {
  return `${CUSTOM_PROMPT_MODULE_ID_PREFIX}${crypto.randomUUID()}`;
}
