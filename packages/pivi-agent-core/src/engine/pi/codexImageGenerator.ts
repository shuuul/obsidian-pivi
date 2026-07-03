const CODEX_RESPONSES_URL = 'https://chatgpt.com/backend-api/codex/responses';
const DEFAULT_CODEX_IMAGE_MODEL = 'gpt-5.5';
const DEFAULT_OUTPUT_FORMAT: CodexImageOutputFormat = 'png';

export type CodexImageOutputFormat = 'png' | 'jpeg' | 'webp';

export interface CodexImageGenerationRequest {
  prompt: string;
  model?: string;
  outputFormat?: CodexImageOutputFormat;
  sessionId?: string;
  signal?: AbortSignal;
}

export interface GeneratedCodexImage {
  data: string;
  mimeType: string;
  outputFormat: CodexImageOutputFormat;
  model: string;
  backendImageModel: 'gpt-image-2';
  responseId?: string;
  imageGenerationId?: string;
  revisedPrompt?: string;
  usage?: unknown;
}

export interface CodexImageGenerator {
  generateImage(request: CodexImageGenerationRequest): Promise<GeneratedCodexImage>;
}

export interface CreateCodexImageGeneratorOptions {
  fetch: (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
  getAccessToken(): Promise<string | undefined>;
  originator?: string;
}

interface ParsedCodexResponse {
  responseId?: string;
  usage?: unknown;
  image?: {
    id?: string;
    result?: string;
    revisedPrompt?: string;
  };
}

function mimeForFormat(format: CodexImageOutputFormat): string {
  switch (format) {
    case 'jpeg':
      return 'image/jpeg';
    case 'webp':
      return 'image/webp';
    case 'png':
    default:
      return 'image/png';
  }
}

function parseOutputFormat(value: CodexImageOutputFormat | undefined): CodexImageOutputFormat {
  return value === 'jpeg' || value === 'webp' || value === 'png' ? value : DEFAULT_OUTPUT_FORMAT;
}

function decodeBase64UrlJson(value: string): Record<string, unknown> {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
  const binary = globalThis.atob(padded);
  const bytes = Uint8Array.from(binary, (ch) => ch.charCodeAt(0));
  return JSON.parse(new TextDecoder().decode(bytes)) as Record<string, unknown>;
}

function extractChatGptAccountId(accessToken: string): string {
  const [, payload] = accessToken.split('.');
  if (!payload) {
    throw new Error('Invalid openai-codex credential. Reconnect ChatGPT Plus/Pro (Codex) in provider settings.');
  }
  const claims = decodeBase64UrlJson(payload);
  const authClaims = claims['https://api.openai.com/auth'];
  if (!authClaims || typeof authClaims !== 'object') {
    throw new Error('OpenAI Codex credential is missing ChatGPT auth claims. Reconnect ChatGPT Plus/Pro (Codex).');
  }
  const accountId = (authClaims as Record<string, unknown>).chatgpt_account_id;
  if (typeof accountId !== 'string' || !accountId.trim()) {
    throw new Error('OpenAI Codex credential is missing chatgpt_account_id. Reconnect ChatGPT Plus/Pro (Codex).');
  }
  return accountId;
}

function buildRequestBody(request: Required<Pick<CodexImageGenerationRequest, 'prompt'>> & {
  model: string;
  outputFormat: CodexImageOutputFormat;
  sessionId: string;
}): string {
  return JSON.stringify({
    model: request.model,
    store: false,
    stream: true,
    prompt_cache_key: request.sessionId,
    instructions: 'You generate exactly one image using the image_generation tool. Return no extra prose beyond the generated image result.',
    input: [
      {
        role: 'user',
        content: [{ type: 'input_text', text: request.prompt }],
      },
    ],
    tools: [{ type: 'image_generation', output_format: request.outputFormat }],
    tool_choice: 'auto',
    parallel_tool_calls: false,
    text: { verbosity: 'low' },
  });
}

function parseSseDataLines(text: string): unknown[] {
  const events: unknown[] = [];
  for (const block of text.split(/\r?\n\r?\n/)) {
    const data = block
      .split(/\r?\n/)
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice('data:'.length).trim())
      .join('\n')
      .trim();
    if (!data || data === '[DONE]') {
      continue;
    }
    events.push(JSON.parse(data));
  }
  return events;
}

function getRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? value as Record<string, unknown> : null;
}

function getString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function parseCodexSse(text: string): ParsedCodexResponse {
  const parsed: ParsedCodexResponse = {};
  for (const rawEvent of parseSseDataLines(text)) {
    const event = getRecord(rawEvent);
    if (!event) {
      continue;
    }
    const type = getString(event.type);
    if (type === 'response.created') {
      const response = getRecord(event.response);
      parsed.responseId = getString(response?.id) ?? parsed.responseId;
    } else if (type === 'response.completed') {
      const response = getRecord(event.response);
      parsed.responseId = getString(response?.id) ?? parsed.responseId;
      parsed.usage = response?.usage ?? parsed.usage;
    } else if (type === 'response.output_item.done') {
      const item = getRecord(event.item);
      if (item?.type === 'image_generation_call') {
        parsed.image = {
          id: getString(item.id),
          result: getString(item.result),
          revisedPrompt: getString(item.revised_prompt),
        };
      }
    } else if (type === 'response.failed' || type === 'error') {
      const error = getRecord(event.error) ?? getRecord(getRecord(event.response)?.error);
      throw new Error(getString(error?.message) ?? 'Codex image generation failed.');
    }
  }
  return parsed;
}

export function createCodexImageGenerator(options: CreateCodexImageGeneratorOptions): CodexImageGenerator {
  return {
    async generateImage(request) {
      const prompt = request.prompt.trim();
      if (!prompt) {
        throw new Error('Image prompt must not be empty.');
      }
      const accessToken = await options.getAccessToken();
      if (!accessToken) {
        throw new Error('Image generation requires the openai-codex provider. Connect ChatGPT Plus/Pro (Codex) in provider settings first.');
      }
      const accountId = extractChatGptAccountId(accessToken);
      const outputFormat = parseOutputFormat(request.outputFormat);
      const model = request.model?.trim() || DEFAULT_CODEX_IMAGE_MODEL;
      const sessionId = request.sessionId?.trim() || `pivi-image-${Date.now()}`;

      const response = await options.fetch(CODEX_RESPONSES_URL, {
        method: 'POST',
        signal: request.signal,
        headers: {
          authorization: `Bearer ${accessToken}`,
          'chatgpt-account-id': accountId,
          originator: options.originator ?? 'pivi',
          'openai-beta': 'responses=experimental',
          accept: 'text/event-stream',
          'content-type': 'application/json',
        },
        body: buildRequestBody({ prompt, model, outputFormat, sessionId }),
      });

      const text = await response.text();
      if (!response.ok) {
        throw new Error(`Codex image generation failed (${response.status}): ${text || response.statusText}`);
      }
      const parsed = parseCodexSse(text);
      if (!parsed.image?.result) {
        throw new Error('Codex image generation completed without image data.');
      }

      return {
        data: parsed.image.result,
        mimeType: mimeForFormat(outputFormat),
        outputFormat,
        model,
        backendImageModel: 'gpt-image-2',
        responseId: parsed.responseId,
        imageGenerationId: parsed.image.id,
        revisedPrompt: parsed.image.revisedPrompt,
        usage: parsed.usage,
      };
    },
  };
}
