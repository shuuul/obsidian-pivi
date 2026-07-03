import {
  configurePiAiEnvironmentHost,
  findEnvKeys,
  getEnvApiKey,
  resetPiAiEnvironmentHost,
} from '@pivi/pivi-agent-core/engine/pi/shims/piAiEnvApiKeys';

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
