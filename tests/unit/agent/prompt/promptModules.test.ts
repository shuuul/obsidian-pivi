import {
  buildPiSystemPrompt,
  buildSystemPrompt,
  composePromptSections,
  computePromptCompositionKey,
  computePiSystemPromptKey,
  createCustomPromptModuleId,
  getShippedPromptModule,
  isShippedPromptModuleId,
  normalizePromptModuleSettings,
  resolvePromptModules,
  SHIPPED_PROMPT_MODULES,
} from '@pivi/agent/prompt';

describe('prompt module registry', () => {
  it('exposes frozen shipped modules in core-then-workflow order', () => {
    expect(Object.isFrozen(SHIPPED_PROMPT_MODULES)).toBe(true);
    const kinds = SHIPPED_PROMPT_MODULES.map((module) => module.kind);
    expect(kinds.indexOf('workflow')).toBeGreaterThan(kinds.lastIndexOf('core'));
    expect(getShippedPromptModule('identity')?.kind).toBe('core');
    expect(getShippedPromptModule('long-line-normalization')).toMatchObject({
      defaultEnabled: false,
    });
    expect(getShippedPromptModule('long-line-normalization')?.defaultBody.length).toBeGreaterThan(0);
    expect(getShippedPromptModule('transcript-cleanup')?.defaultEnabled).toBe(true);
    expect(getShippedPromptModule('transcript-cleanup')?.defaultBody.length).toBeGreaterThan(0);
  });

  it('generates custom ids that never collide with shipped ids', () => {
    const ids = new Set(Array.from({ length: 8 }, () => createCustomPromptModuleId()));
    expect(ids.size).toBe(8);
    for (const id of ids) {
      expect(id.startsWith('custom:')).toBe(true);
      expect(isShippedPromptModuleId(id)).toBe(false);
    }
  });
});

describe('prompt module composition', () => {
  it('uses an unambiguous cache key for user-authored delimiters', () => {
    const bodyDelimiter = computePromptCompositionKey({}, [
      { id: 'custom:x', enabled: true, title: 'a', body: 'b:c' },
    ]);
    const titleDelimiter = computePromptCompositionKey({}, [
      { id: 'custom:x', enabled: true, title: 'a:b', body: 'c' },
    ]);

    expect(bodyDelimiter).not.toBe(titleDelimiter);
  });

  it('includes default-on workflow bodies and omits default-off long-line-normalization', () => {
    const composed = composePromptSections();
    expect(composed.workflow).toContain('## Transcript cleanup');
    expect(composed.workflow).toContain('## Wikilink conventions');
    expect(composed.workflow).toContain('## Frontmatter conventions');
    expect(composed.workflow).toContain('## Daily / periodic notes');
    expect(composed.workflow).not.toContain('## Long-line normalization');
    expect(composed.fullStatic).toContain('You are **Pivi**');
    expect(composed.fullStatic).toContain(composed.workflow);
    expect(composed.workflow).toContain('`>>` as the turn delimiter');
    expect(composed.workflow).toContain('When authoring wikilinks in notes');
    expect(composed.workflow).not.toContain('When this module is enabled');
    expect(composed.workflow).not.toContain('owned by File References');
    expect(composed.workflow).toContain('Respect existing YAML frontmatter');
    expect(composed.workflow).toContain('Do not create ad-hoc daily files that bypass the daily-notes plugin');
  });

  it('ignores persisted disable and customBody on core modules', () => {
    const prompt = buildSystemPrompt({}, {
      promptModules: {
        identity: { enabled: false, customBody: 'CORE OVERRIDE MARKER' },
      },
    });
    expect(prompt).toContain('You are **Pivi**');
    expect(prompt).toContain('**Safety First**');
    expect(prompt).not.toContain('CORE OVERRIDE MARKER');
  });

  it('replaces a shipped workflow body verbatim and omits it when disabled', () => {
    const marker = 'TRANSCRIPT CLEANUP CUSTOM BODY';
    const enabled = buildSystemPrompt({}, {
      promptModules: {
        'transcript-cleanup': { customBody: marker },
      },
    });
    const disabled = buildSystemPrompt({}, {
      promptModules: {
        'transcript-cleanup': { enabled: false, customBody: marker },
      },
    });

    expect(enabled).toContain('## Transcript cleanup');
    expect(enabled).toContain(marker);
    expect(disabled).not.toContain(marker);
    expect(disabled).not.toContain('## Transcript cleanup');
    expect(disabled).toContain('You are **Pivi**');
  });

  it('ignores unknown shipped-module ids at composition', () => {
    const prompt = buildSystemPrompt({}, {
      promptModules: {
        'not-a-real-module': { enabled: true, customBody: 'UNKNOWN MODULE BODY' },
      },
    });
    expect(prompt).not.toContain('UNKNOWN MODULE BODY');
    expect(prompt).toContain('You are **Pivi**');
  });

  it('appends custom modules after shipped workflow in persisted order', () => {
    const prompt = buildSystemPrompt({}, {
      promptModules: {
        'transcript-cleanup': { customBody: 'SHIPPED WORKFLOW BODY' },
      },
      customPromptModules: [
        { id: 'custom:second', title: 'Second custom', body: 'SECOND CUSTOM BODY', enabled: true },
        { id: 'custom:first', title: 'First custom', body: 'FIRST CUSTOM BODY', enabled: true },
        { id: 'custom:off', title: 'Disabled custom', body: 'DISABLED CUSTOM BODY', enabled: false },
        { id: 'custom:empty', title: 'Empty custom', body: '   ', enabled: true },
      ],
    });

    expect(prompt).toContain('SHIPPED WORKFLOW BODY');
    expect(prompt).toContain('## Second custom');
    expect(prompt).toContain('SECOND CUSTOM BODY');
    expect(prompt).toContain('## First custom');
    expect(prompt).toContain('FIRST CUSTOM BODY');
    expect(prompt).not.toContain('DISABLED CUSTOM BODY');
    expect(prompt.indexOf('SHIPPED WORKFLOW BODY')).toBeLessThan(prompt.indexOf('SECOND CUSTOM BODY'));
    expect(prompt.indexOf('SECOND CUSTOM BODY')).toBeLessThan(prompt.indexOf('FIRST CUSTOM BODY'));
  });

  it('lists disabled workflow and custom modules for settings without injecting them', () => {
    const resolved = resolvePromptModules(
      { 'transcript-cleanup': { enabled: false } },
      [{ id: 'custom:off', title: 'Off', body: 'hidden', enabled: false }],
    );
    const transcript = resolved.find((module) => module.id === 'transcript-cleanup');
    const custom = resolved.find((module) => module.id === 'custom:off');
    expect(transcript).toMatchObject({ enabled: false, modified: false });
    expect(custom).toMatchObject({ enabled: false, kind: 'custom' });
    expect(composePromptSections({
      overrides: { 'transcript-cleanup': { enabled: false } },
      custom: [{ id: 'custom:off', title: 'Off', body: 'hidden', enabled: false }],
    }).fullStatic).not.toContain('hidden');
  });

  it('drops the daily-notes tool line when that tool is unregistered', () => {
    const withDaily = composePromptSections({
      registeredToolNames: ['obsidian_daily', 'read'],
    });
    const withoutDaily = composePromptSections({
      registeredToolNames: ['read'],
    });

    expect(withDaily.workflow).toContain('Prefer `obsidian_daily` for daily notes');
    expect(withoutDaily.workflow).not.toContain('obsidian_daily');
    expect(withoutDaily.workflow).toContain('Do not create ad-hoc daily files that bypass the daily-notes plugin');
    expect(withoutDaily.workflow).toContain('Periodic note naming stays user-owned');
  });
});

describe('normalizePromptModuleSettings', () => {
  it('preserves unknown override keys and drops invalid custom entries', () => {
    const normalized = normalizePromptModuleSettings(
      {
        'not-a-real-module': { enabled: true, customBody: 'keep me' },
        identity: { enabled: false, customBody: 'ignored at compose' },
        garbage: 'nope',
      },
      [
        { id: 'identity', title: 'Collides', body: 'no', enabled: true },
        { id: '', title: 'Missing id', body: 'no', enabled: true },
        { id: 'custom:ok', title: 'Ok', body: 'yes', enabled: true },
        { id: 'custom:bad', title: 'Bad' },
        'not-an-object',
      ],
    );

    expect(normalized.promptModules['not-a-real-module']).toEqual({
      enabled: true,
      customBody: 'keep me',
    });
    expect(normalized.promptModules.identity).toEqual({
      enabled: false,
      customBody: 'ignored at compose',
    });
    expect(normalized.promptModules.garbage).toBeUndefined();
    expect(normalized.customPromptModules).toEqual([
      { id: 'custom:ok', title: 'Ok', body: 'yes', enabled: true },
    ]);
  });
});

describe('long-line-normalization workflow module', () => {
  it('injects pre-edit semantic split instructions only when enabled', () => {
    const enabled = buildSystemPrompt({}, {
      promptModules: { 'long-line-normalization': { enabled: true } },
    });
    const disabled = buildSystemPrompt();

    expect(enabled).toContain('## Long-line normalization');
    expect(enabled).toContain('Before further work on a note with oversized physical lines');
    expect(enabled).toContain('split those lines at semantic boundaries with `edit`');
    expect(enabled).not.toContain('When this module is enabled');
    expect(disabled).not.toContain('## Long-line normalization');
    expect(disabled).not.toContain('Before further work on a note with oversized physical lines');
    expect(disabled).not.toContain('split those lines at semantic boundaries');
    expect(disabled).toContain('If one physical line is oversized');
    expect(disabled).toContain('`edit` for exact local replacement, including inserting line endings');
  });
});

describe('buildPiSystemPrompt composition', () => {
  it('includes settings composition in the built prompt and cache key', () => {
    const marker = 'PI WORKFLOW CUSTOM BODY';
    const enabled = {
      promptModules: { 'transcript-cleanup': { customBody: marker } },
      customPromptModules: [],
    };
    const disabled = {
      promptModules: { 'transcript-cleanup': { enabled: false } },
      customPromptModules: [],
    };

    expect(buildPiSystemPrompt('/vault', 'Ada', undefined, enabled)).toContain(marker);
    expect(buildPiSystemPrompt('/vault', 'Ada', undefined, disabled)).not.toContain('## Transcript cleanup');
    expect(computePiSystemPromptKey('/vault', 'Ada', undefined, enabled))
      .not.toBe(computePiSystemPromptKey('/vault', 'Ada', undefined, disabled));
  });
});
