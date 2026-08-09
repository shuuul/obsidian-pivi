import { projectMobileCapabilities } from '@/app/composition/mobile/capabilityProjection';
import { MOBILE_PLATFORM_CAPABILITIES } from '@/app/platformCapabilities';

describe('Mobile capability projection', () => {
  it('hard-gates the composer until every required browser-safe Vault tool exists', () => {
    const projection = projectMobileCapabilities(MOBILE_PLATFORM_CAPABILITIES);
    expect(projection.tools).toEqual([]);
    expect(projection.subagentTools).toEqual([]);
    expect(projection.promptAuthorities).toEqual(projection.tools);
    expect(projection.missingRequiredTools).toContain('obsidian_read');
    expect(projection.canExposeComposer).toBe(false);
  });

  it('exposes only minimal Mobile settings and no unproven target slash sources', () => {
    const projection = projectMobileCapabilities(MOBILE_PLATFORM_CAPABILITIES);
    expect(projection.settingsSections).toEqual(['providers', 'models', 'api-keys']);
    expect(projection.slashSources).toEqual([]);
    expect(JSON.stringify(projection)).not.toMatch(
      /bash|eval|command|stdio|external|environment|localhost|oauth|toolbar|mcp|skill|image|web/i,
    );
  });
});
