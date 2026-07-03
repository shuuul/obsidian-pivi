/**
 * Obsidian-safe replacement for @earendil-works/pi-ai/dist/env-api-keys.js.
 * Upstream uses dynamic import("node:" + "fs") for browser/Vite compatibility;
 * in Obsidian's renderer that becomes a URL fetch and fails at plugin load.
 */
import { existsSync, readFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

export interface PiAiEnvironmentHost {
  getEnvironmentVariable(name: string): string | undefined;
  shouldReadProcessEnvironmentFallback(): boolean;
  readProcessEnvironment(): string | null;
  hasFile(path: string): boolean;
  getHomeDirectory(): string;
  joinPath(...segments: string[]): string;
}

function getProcessEnvironmentVariable(name: string): string | undefined {
  return process.env[name];
}

const defaultEnvironmentHost: PiAiEnvironmentHost = {
  getEnvironmentVariable: getProcessEnvironmentVariable,
  shouldReadProcessEnvironmentFallback: () => !!process.versions?.bun
    && Object.keys(process.env).length === 0,
  readProcessEnvironment: () => {
    try {
      return readFileSync('/proc/self/environ', 'utf-8');
    } catch {
      return null;
    }
  },
  hasFile: existsSync,
  getHomeDirectory: homedir,
  joinPath: join,
};

let environmentHost: PiAiEnvironmentHost = defaultEnvironmentHost;
let procEnvCache: Map<string, string> | null = null;
let cachedVertexAdcCredentialsExists: boolean | null = null;

export function configurePiAiEnvironmentHost(host: Partial<PiAiEnvironmentHost>): void {
  environmentHost = { ...defaultEnvironmentHost, ...host };
  procEnvCache = null;
  cachedVertexAdcCredentialsExists = null;
}

export function resetPiAiEnvironmentHost(): void {
  environmentHost = defaultEnvironmentHost;
  procEnvCache = null;
  cachedVertexAdcCredentialsExists = null;
}

/**
 * Fallback for https://github.com/oven-sh/bun/issues/27802
 * Bun compiled binaries have an empty `process.env` inside sandbox
 * environments on Linux. We can recover the env from `/proc/self/environ`.
 */
function getProcEnv(key: string): string | undefined {
  if (!environmentHost.shouldReadProcessEnvironmentFallback()) {
    return undefined;
  }
  if (procEnvCache === null) {
    procEnvCache = new Map();
    const data = environmentHost.readProcessEnvironment();
    if (data) {
      for (const entry of data.split('\0')) {
        const idx = entry.indexOf('=');
        if (idx > 0) {
          procEnvCache.set(entry.slice(0, idx), entry.slice(idx + 1));
        }
      }
    }
  }
  return procEnvCache.get(key);
}

function getEnvironmentVariable(key: string): string | undefined {
  return environmentHost.getEnvironmentVariable(key) || getProcEnv(key);
}

function hasVertexAdcCredentials(): boolean {
  if (cachedVertexAdcCredentialsExists === null) {
    const gacPath = getEnvironmentVariable('GOOGLE_APPLICATION_CREDENTIALS');
    if (gacPath) {
      cachedVertexAdcCredentialsExists = environmentHost.hasFile(gacPath);
    } else {
      cachedVertexAdcCredentialsExists = environmentHost.hasFile(
        environmentHost.joinPath(
          environmentHost.getHomeDirectory(),
          '.config',
          'gcloud',
          'application_default_credentials.json',
        ),
      );
    }
  }
  return cachedVertexAdcCredentialsExists;
}

function getApiKeyEnvVars(provider: string): string[] | undefined {
  if (provider === 'github-copilot') {
    return ['COPILOT_GITHUB_TOKEN'];
  }
  if (provider === 'anthropic') {
    return ['ANTHROPIC_OAUTH_TOKEN', 'ANTHROPIC_API_KEY'];
  }
  const envMap: Record<string, string> = {
    openai: 'OPENAI_API_KEY',
    'azure-openai-responses': 'AZURE_OPENAI_API_KEY',
    deepseek: 'DEEPSEEK_API_KEY',
    google: 'GEMINI_API_KEY',
    'google-vertex': 'GOOGLE_CLOUD_API_KEY',
    groq: 'GROQ_API_KEY',
    cerebras: 'CEREBRAS_API_KEY',
    xai: 'XAI_API_KEY',
    openrouter: 'OPENROUTER_API_KEY',
    'vercel-ai-gateway': 'AI_GATEWAY_API_KEY',
    zai: 'ZAI_API_KEY',
    mistral: 'MISTRAL_API_KEY',
    minimax: 'MINIMAX_API_KEY',
    'minimax-cn': 'MINIMAX_CN_API_KEY',
    moonshotai: 'MOONSHOT_API_KEY',
    'moonshotai-cn': 'MOONSHOT_API_KEY',
    huggingface: 'HF_TOKEN',
    fireworks: 'FIREWORKS_API_KEY',
    together: 'TOGETHER_API_KEY',
    opencode: 'OPENCODE_API_KEY',
    'opencode-go': 'OPENCODE_API_KEY',
    'kimi-coding': 'KIMI_API_KEY',
    'cloudflare-workers-ai': 'CLOUDFLARE_API_KEY',
    'cloudflare-ai-gateway': 'CLOUDFLARE_API_KEY',
    xiaomi: 'XIAOMI_API_KEY',
    'xiaomi-token-plan-cn': 'XIAOMI_TOKEN_PLAN_CN_API_KEY',
    'xiaomi-token-plan-ams': 'XIAOMI_TOKEN_PLAN_AMS_API_KEY',
    'xiaomi-token-plan-sgp': 'XIAOMI_TOKEN_PLAN_SGP_API_KEY',
  };
  const envVar = envMap[provider];
  return envVar ? [envVar] : undefined;
}

export function findEnvKeys(provider: string): string[] | undefined {
  const envVars = getApiKeyEnvVars(provider);
  if (!envVars) {
    return undefined;
  }
  const found = envVars.filter((envVar) => !!getEnvironmentVariable(envVar));
  return found.length > 0 ? found : undefined;
}

export function getEnvApiKey(provider: string): string | undefined {
  const envKeys = findEnvKeys(provider);
  if (envKeys?.[0]) {
    return getEnvironmentVariable(envKeys[0]);
  }
  if (provider === 'google-vertex') {
    const hasCredentials = hasVertexAdcCredentials();
    const hasProject = !!(
      getEnvironmentVariable('GOOGLE_CLOUD_PROJECT')
      || getEnvironmentVariable('GCLOUD_PROJECT')
    );
    const hasLocation = !!getEnvironmentVariable('GOOGLE_CLOUD_LOCATION');
    if (hasCredentials && hasProject && hasLocation) {
      return '<authenticated>';
    }
  }
  if (provider === 'amazon-bedrock') {
    if (
      getEnvironmentVariable('AWS_PROFILE')
      || (getEnvironmentVariable('AWS_ACCESS_KEY_ID') && getEnvironmentVariable('AWS_SECRET_ACCESS_KEY'))
      || getEnvironmentVariable('AWS_BEARER_TOKEN_BEDROCK')
      || getEnvironmentVariable('AWS_CONTAINER_CREDENTIALS_RELATIVE_URI')
      || getEnvironmentVariable('AWS_CONTAINER_CREDENTIALS_FULL_URI')
      || getEnvironmentVariable('AWS_WEB_IDENTITY_TOKEN_FILE')
    ) {
      return '<authenticated>';
    }
  }
  return undefined;
}
