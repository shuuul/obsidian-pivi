import type { HttpClient, HttpRequest, HttpResponse } from '@pivi/pivi-agent-core/ports';
import { requestUrl } from 'obsidian';

export const obsidianHttpClient: HttpClient = {
  async fetch(request: HttpRequest): Promise<HttpResponse> {
    const response = await requestUrl({
      url: request.url,
      method: request.method,
      headers: request.headers,
      body: typeof request.body === 'string' ? request.body : undefined,
      throw: false,
    });

    const text = typeof response.text === 'string' ? response.text : '';
    return {
      ok: response.status >= 200 && response.status < 300,
      status: response.status,
      headers: response.headers,
      text: async () => text,
      json: async <T = unknown>() => (
        response.json !== undefined ? response.json as T : JSON.parse(text) as T
      ),
    };
  },
};
