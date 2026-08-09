import type { PiviPlatformCapabilities } from '@/app/platformCapabilities';

const MOBILE_VAULT_TOOLS = [
  'obsidian_read', 'obsidian_markdown_structure', 'obsidian_search', 'obsidian_list',
  'obsidian_note_info', 'obsidian_links', 'obsidian_properties', 'obsidian_tags',
  'obsidian_graph', 'obsidian_write', 'obsidian_edit', 'obsidian_move',
  'obsidian_delete', 'obsidian_mkdir', 'obsidian_attachment',
] as const;

export interface MobileCapabilityProjection {
  readonly tools: readonly string[];
  readonly subagentTools: readonly string[];
  readonly settingsSections: readonly string[];
  readonly slashSources: readonly string[];
  readonly promptAuthorities: readonly string[];
  readonly missingRequiredTools: readonly string[];
  readonly canExposeComposer: boolean;
}

/** One authority projection consumed by every eventual Mobile product surface. */
export function projectMobileCapabilities(
  capabilities: PiviPlatformCapabilities,
  availableSafeTools: readonly string[] = [],
): MobileCapabilityProjection {
  if (capabilities.platform !== 'mobile') {
    throw new Error('Mobile projection requires Mobile platform capabilities');
  }
  const available = new Set(availableSafeTools);
  const tools = MOBILE_VAULT_TOOLS.filter(tool => available.has(tool));
  const missingRequiredTools = MOBILE_VAULT_TOOLS.filter(tool => !available.has(tool));
  return {
    tools,
    subagentTools: [],
    settingsSections: ['providers', 'models', 'api-keys'],
    slashSources: [],
    promptAuthorities: tools,
    missingRequiredTools,
    canExposeComposer: missingRequiredTools.length === 0,
  };
}

export { MOBILE_VAULT_TOOLS };
