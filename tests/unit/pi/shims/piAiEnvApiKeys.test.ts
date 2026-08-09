import {
  ANTHROPIC_API_KEY_ENV,
  ANTHROPIC_AUTH_TOKEN_ENV,
  ANTHROPIC_OAUTH_TOKEN_ENV,
  configurePiAiEnvironmentHost,
  findEnvKeys,
  getEnvApiKey,
  resetPiAiEnvironmentHost,
} from '@pivi/engine-pi/shims/piAiEnvApiKeys';

function configureEnv(values: Record<string, string | undefined>): void {
  configurePiAiEnvironmentHost({
    getEnvironmentVariable: (name) => values[name],
    shouldReadProcessEnvironmentFallback: () => false,
    readProcessEnvironment: () => null,
    hasFile: () => false,
    getHomeDirectory: () => '/home/test',
    joinPath: (...segments) => segments.join('/'),
  });
}

describe('piAiEnvApiKeys host seams', () => {
  afterEach(() => {
    resetPiAiEnvironmentHost();
  });

  it('finds and reads API keys through the injected environment lookup', () => {
    configureEnv({ DEEPSEEK_API_KEY: 'deepseek-key' });

    expect(findEnvKeys('deepseek')).toEqual(['DEEPSEEK_API_KEY']);
    expect(getEnvApiKey('deepseek')).toBe('deepseek-key');
  });

  it('prefers scoped provider environment values over the host environment', () => {
    configureEnv({ DEEPSEEK_API_KEY: 'host-key' });

    expect(getEnvApiKey('deepseek', { DEEPSEEK_API_KEY: 'scoped-key' })).toBe('scoped-key');
  });

  it('reports Anthropic bearer auth but only returns OAuth or API keys', () => {
    configureEnv({
      [ANTHROPIC_AUTH_TOKEN_ENV]: 'bearer-token',
      [ANTHROPIC_OAUTH_TOKEN_ENV]: 'oauth-token',
      [ANTHROPIC_API_KEY_ENV]: 'api-key',
    });

    expect(findEnvKeys('anthropic')).toEqual([
      ANTHROPIC_AUTH_TOKEN_ENV,
      ANTHROPIC_OAUTH_TOKEN_ENV,
      ANTHROPIC_API_KEY_ENV,
    ]);
    expect(getEnvApiKey('anthropic')).toBe('oauth-token');
  });

  it('reads Bun process-environ fallback text when the host enables it', () => {
    configurePiAiEnvironmentHost({
      getEnvironmentVariable: () => undefined,
      shouldReadProcessEnvironmentFallback: () => true,
      readProcessEnvironment: () => 'DEEPSEEK_API_KEY=from-proc\0IGNORED\0',
      hasFile: () => false,
      getHomeDirectory: () => '/home/test',
      joinPath: (...segments) => segments.join('/'),
    });

    expect(findEnvKeys('deepseek')).toEqual(['DEEPSEEK_API_KEY']);
    expect(getEnvApiKey('deepseek')).toBe('from-proc');
  });

  it('authenticates google-vertex from injected ADC file and project settings', () => {
    const checkedPaths: string[] = [];
    configurePiAiEnvironmentHost({
      getEnvironmentVariable: (name) => ({
        GOOGLE_CLOUD_PROJECT: 'project-1',
        GOOGLE_CLOUD_LOCATION: 'us-central1',
      }[name]),
      shouldReadProcessEnvironmentFallback: () => false,
      readProcessEnvironment: () => null,
      hasFile: (path) => {
        checkedPaths.push(path);
        return path === '/home/test/.config/gcloud/application_default_credentials.json';
      },
      getHomeDirectory: () => '/home/test',
      joinPath: (...segments) => segments.join('/'),
    });

    expect(getEnvApiKey('google-vertex')).toBe('<authenticated>');
    expect(checkedPaths).toEqual(['/home/test/.config/gcloud/application_default_credentials.json']);
  });

  it('resets cached ADC state when the host changes', () => {
    configurePiAiEnvironmentHost({
      getEnvironmentVariable: (name) => ({
        GOOGLE_CLOUD_PROJECT: 'project-1',
        GOOGLE_CLOUD_LOCATION: 'us-central1',
      }[name]),
      shouldReadProcessEnvironmentFallback: () => false,
      readProcessEnvironment: () => null,
      hasFile: () => true,
      getHomeDirectory: () => '/home/test',
      joinPath: (...segments) => segments.join('/'),
    });
    expect(getEnvApiKey('google-vertex')).toBe('<authenticated>');

    configureEnv({
      GOOGLE_CLOUD_PROJECT: 'project-1',
      GOOGLE_CLOUD_LOCATION: 'us-central1',
    });

    expect(getEnvApiKey('google-vertex')).toBeUndefined();
  });
});
