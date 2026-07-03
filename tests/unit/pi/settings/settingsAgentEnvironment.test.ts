import {
  classifyEnvironmentVariablesByOwnership,
  getAgentEnvironmentVariables,
  getEnvironmentReviewKeysForScope,
  getEnvironmentScopeUpdates,
  getEnvironmentVariablesForScope,
  getRuntimeEnvironmentText,
  getSharedEnvironmentVariables,
  inferEnvironmentSnippetScope,
  joinEnvironmentTexts,
  normalizeEnvironmentScope,
  resolveEnvironmentSnippetScope,
  setAgentEnvironmentVariables,
  setEnvironmentVariablesForScope,
  setSharedEnvironmentVariables,
} from '@pivi/pivi-agent-core/foundation/settingsAgentEnvironment';

function settingsBag(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return { ...overrides };
}

describe('classifyEnvironmentVariablesByOwnership', () => {
  it('routes known shared keys and PI_* agent keys into separate buckets', () => {
    const input = [
      'PATH=/usr/bin',
      'HTTP_PROXY=http://proxy',
      'SSL_CERT_FILE=/certs.pem',
      'TMPDIR=/tmp',
      'PI_API_KEY=secret',
      'pi_custom=yes',
    ].join('\n');

    expect(classifyEnvironmentVariablesByOwnership(input)).toEqual({
      shared: [
        'PATH=/usr/bin',
        'HTTP_PROXY=http://proxy',
        'SSL_CERT_FILE=/certs.pem',
        'TMPDIR=/tmp',
      ].join('\n'),
      agent: ['PI_API_KEY=secret', 'pi_custom=yes'].join('\n'),
      reviewKeys: [],
    });
  });

  it('flags unknown non-PI keys as reviewKeys while keeping them in shared text', () => {
    const classified = classifyEnvironmentVariablesByOwnership(
      'ANTHROPIC_API_KEY=sk-test\nPI_MODEL=fast',
    );

    expect(classified.shared).toBe('ANTHROPIC_API_KEY=sk-test');
    expect(classified.agent).toBe('PI_MODEL=fast');
    expect(classified.reviewKeys).toEqual(['ANTHROPIC_API_KEY']);
  });

  it('attaches comment and blank decorator lines to the following classified assignment', () => {
    const input = [
      '# shared header',
      '',
      'PATH=/bin',
      '# agent header',
      'PI_FLAG=1',
    ].join('\n');

    const classified = classifyEnvironmentVariablesByOwnership(input);

    expect(classified.shared).toBe(['# shared header', '', 'PATH=/bin'].join('\n'));
    expect(classified.agent).toBe(['# agent header', 'PI_FLAG=1'].join('\n'));
    expect(classified.reviewKeys).toEqual([]);
  });

  it('keeps trailing comment-only lines in the shared bucket', () => {
    const classified = classifyEnvironmentVariablesByOwnership(
      ['PI_ONLY=1', '# trailing note'].join('\n'),
    );

    expect(classified.agent).toBe('PI_ONLY=1');
    expect(classified.shared).toBe('# trailing note');
  });
});

describe('legacy environmentVariables migration via getters', () => {
  it('splits legacy environmentVariables when scoped fields are absent', () => {
    const settings = settingsBag({
      environmentVariables: [
        'PATH=/legacy',
        'CUSTOM_KEY=value',
        'PI_TOKEN=agent',
      ].join('\n'),
    });

    expect(getSharedEnvironmentVariables(settings)).toBe(
      ['PATH=/legacy', 'CUSTOM_KEY=value'].join('\n'),
    );
    expect(getAgentEnvironmentVariables(settings)).toBe('PI_TOKEN=agent');
    expect(
      classifyEnvironmentVariablesByOwnership(
        String(settings.environmentVariables),
      ).reviewKeys,
    ).toEqual(['CUSTOM_KEY']);
  });

  it('prefers explicit sharedEnvironmentVariables over legacy split', () => {
    const settings = settingsBag({
      sharedEnvironmentVariables: 'PATH=/explicit',
      environmentVariables: 'PI_SHOULD_NOT_WIN=1',
    });

    expect(getSharedEnvironmentVariables(settings)).toBe('PATH=/explicit');
  });

  it('prefers agentSettings.environmentVariables over legacy split', () => {
    const settings = settingsBag({
      agentSettings: {
        environmentVariables: 'PI_EXPLICIT=1',
        selectedMode: 'default',
        visibleModels: [],
      },
      environmentVariables: 'PATH=/legacy',
    });

    expect(getAgentEnvironmentVariables(settings)).toBe('PI_EXPLICIT=1');
  });
});

describe('environment variable setters', () => {
  it('writes sharedEnvironmentVariables and removes legacy environmentVariables', () => {
    const settings = settingsBag({
      environmentVariables: 'PATH=/old',
    });

    setSharedEnvironmentVariables(settings, 'PATH=/new');

    expect(settings.sharedEnvironmentVariables).toBe('PATH=/new');
    expect(settings.environmentVariables).toBeUndefined();
  });

  it('writes agentSettings.environmentVariables and removes legacy environmentVariables', () => {
    const settings = settingsBag({
      environmentVariables: 'PI_OLD=1',
    });

    setAgentEnvironmentVariables(settings, 'PI_NEW=2');

    expect(settings.agentSettings).toEqual({
      environmentVariables: 'PI_NEW=2',
      selectedMode: 'default',
      visibleModels: [],
    });
    expect(settings.environmentVariables).toBeUndefined();
  });
});

describe('joinEnvironmentTexts and runtime text', () => {
  it('joins non-empty parts with a single newline between shared and agent', () => {
    expect(
      joinEnvironmentTexts('PATH=/bin', 'PI_KEY=1'),
    ).toBe('PATH=/bin\nPI_KEY=1');
  });

  it('builds runtime text as shared block then agent block', () => {
    const settings = settingsBag({
      sharedEnvironmentVariables: 'PATH=/bin',
      agentSettings: {
        environmentVariables: 'PI_RUN=1',
        selectedMode: 'default',
        visibleModels: [],
      },
    });

    expect(getRuntimeEnvironmentText(settings)).toBe('PATH=/bin\nPI_RUN=1');
  });
});

describe('scope routing getters and setters', () => {
  it('reads and writes through shared and agent scopes', () => {
    const settings = settingsBag();

    setEnvironmentVariablesForScope(settings, 'shared', 'TMP=/tmp');
    setEnvironmentVariablesForScope(settings, 'agent', 'PI_SCOPE=1');

    expect(getEnvironmentVariablesForScope(settings, 'shared')).toBe('TMP=/tmp');
    expect(getEnvironmentVariablesForScope(settings, 'agent')).toBe('PI_SCOPE=1');
  });
});

describe('getEnvironmentReviewKeysForScope', () => {
  const snippet = 'PATH=/bin\nMYSTERY=x\nPI_AGENT=y';

  it('flags only non-known-shared keys when scope is shared', () => {
    expect(getEnvironmentReviewKeysForScope(snippet, 'shared')).toEqual([
      'MYSTERY',
      'PI_AGENT',
    ]);
  });

  it('flags only non-agent keys when scope is agent', () => {
    expect(getEnvironmentReviewKeysForScope(snippet, 'agent')).toEqual([
      'PATH',
      'MYSTERY',
    ]);
  });
});

describe('normalizeEnvironmentScope', () => {
  it.each([
    ['shared', 'shared'],
    ['agent', 'agent'],
    ['pi', 'agent'],
    ['provider:pi', 'agent'],
    ['provider:openai', undefined],
    [null, undefined],
  ] as const)('maps %s to %s', (value, expected) => {
    expect(normalizeEnvironmentScope(value)).toBe(expected);
  });
});

describe('inferEnvironmentSnippetScope', () => {
  it('returns shared for shared-only meaningful content', () => {
    expect(inferEnvironmentSnippetScope('PATH=/bin\n# note')).toBe('shared');
  });

  it('returns agent for agent-only meaningful content', () => {
    expect(inferEnvironmentSnippetScope('PI_ONLY=1')).toBe('agent');
  });

  it('returns undefined for mixed shared and agent content', () => {
    expect(
      inferEnvironmentSnippetScope('PATH=/bin\nPI_MIXED=1'),
    ).toBeUndefined();
  });

  it('returns undefined for comments-only snippets', () => {
    expect(inferEnvironmentSnippetScope('# just a comment\n')).toBeUndefined();
  });
});

describe('resolveEnvironmentSnippetScope', () => {
  it('prefers inferred scope over fallback when inference is unambiguous', () => {
    expect(resolveEnvironmentSnippetScope('PI_ONLY=1', 'shared')).toBe('agent');
  });

  it('uses fallback for comments-only snippets', () => {
    expect(
      resolveEnvironmentSnippetScope('# header only', 'agent'),
    ).toBe('agent');
  });

  it('returns undefined for ambiguous meaningful content even with fallback', () => {
    expect(
      resolveEnvironmentSnippetScope('PATH=/bin\nPI_X=1', 'shared'),
    ).toBeUndefined();
  });
});

describe('getEnvironmentScopeUpdates', () => {
  it('emits separate shared and agent updates for mixed snippets', () => {
    expect(
      getEnvironmentScopeUpdates('PATH=/bin\nPI_KEY=1'),
    ).toEqual([
      { scope: 'shared', envText: 'PATH=/bin' },
      { scope: 'agent', envText: 'PI_KEY=1' },
    ]);
  });

  it('emits a single shared update for shared-only snippets', () => {
    expect(getEnvironmentScopeUpdates('HTTP_PROXY=http://p')).toEqual([
      { scope: 'shared', envText: 'HTTP_PROXY=http://p' },
    ]);
  });

  it('emits a single agent update for agent-only snippets', () => {
    expect(getEnvironmentScopeUpdates('PI_SOLO=1')).toEqual([
      { scope: 'agent', envText: 'PI_SOLO=1' },
    ]);
  });

  it('uses fallback scope when snippet has no meaningful assignments', () => {
    expect(getEnvironmentScopeUpdates('# notes only', 'shared')).toEqual([
      { scope: 'shared', envText: '# notes only' },
    ]);
  });

  it('classifies comment-only snippets as a shared-scope update', () => {
    expect(getEnvironmentScopeUpdates('# only comments')).toEqual([
      { scope: 'shared', envText: '# only comments' },
    ]);
  });

  it('returns no updates for whitespace-only snippets without fallback', () => {
    expect(getEnvironmentScopeUpdates('   \n  ')).toEqual([]);
  });
});