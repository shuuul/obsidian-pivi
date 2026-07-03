import type { HttpClient, HttpRequest, HttpResponse } from '@pivi/pivi-agent-core/ports';
import { testEndpointConnectivity } from '@pivi/pivi-agent-core/runtime/connectivity';

function createHttpResponse(status: number): HttpResponse {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {},
    text: async () => '',
    json: async <T = unknown>() => ({} as T),
  };
}

function mockHttpClient(
  handler: (request: HttpRequest) => Promise<HttpResponse>,
): HttpClient {
  return {
    fetch: jest.fn(handler),
  };
}

describe('testEndpointConnectivity', () => {
  it('returns failure without calling fetch when URL is blank', async () => {
    const httpClient = mockHttpClient(async () => createHttpResponse(200));

    const result = await testEndpointConnectivity(httpClient, '   ');

    expect(result).toEqual({ ok: false, detail: 'No endpoint URL configured.' });
    expect(httpClient.fetch).not.toHaveBeenCalled();
  });

  it('probes the trimmed endpoint with HEAD via HttpClient.fetch', async () => {
    const httpClient = mockHttpClient(async () => createHttpResponse(204));

    await testEndpointConnectivity(httpClient, '  https://api.example.com/v1  ');

    expect(httpClient.fetch).toHaveBeenCalledWith({
      url: 'https://api.example.com/v1',
      method: 'HEAD',
    });
  });

  it.each([
    { status: 200, expectedOk: true },
    { status: 204, expectedOk: true },
    { status: 404, expectedOk: true },
    { status: 499, expectedOk: true },
    { status: 500, expectedOk: false },
    { status: 503, expectedOk: false },
  ])('treats HTTP $status as reachable=$expectedOk by default', async ({ status, expectedOk }) => {
    const httpClient = mockHttpClient(async () => createHttpResponse(status));
    const url = 'https://api.example.com';

    const result = await testEndpointConnectivity(httpClient, url);

    expect(result.ok).toBe(expectedOk);
    expect(result.detail).toBe(`${url} responded with status ${status}`);
  });

  it('honors a custom status predicate when provided', async () => {
    const httpClient = mockHttpClient(async () => createHttpResponse(404));
    const url = 'https://api.example.com';

    const result = await testEndpointConnectivity(httpClient, url, {
      isReachableStatus: (status) => status >= 200 && status < 400,
    });

    expect(result.ok).toBe(false);
    expect(result.detail).toBe(`${url} responded with status 404`);
  });

  it('returns ok:false with URL and error message when fetch throws', async () => {
    const httpClient = mockHttpClient(async () => {
      throw new Error('connection refused');
    });
    const url = 'https://api.example.com';

    const result = await testEndpointConnectivity(httpClient, url);

    expect(result).toEqual({
      ok: false,
      detail: `${url}: connection refused`,
    });
  });

  it('stringifies non-Error throw values in failure detail', async () => {
    const httpClient = mockHttpClient(async () => {
      throw 'offline';
    });

    const result = await testEndpointConnectivity(httpClient, 'https://api.example.com');

    expect(result.ok).toBe(false);
    expect(result.detail).toBe('https://api.example.com: offline');
  });

  it('appends an optional detail suffix to successful probe detail', async () => {
    const httpClient = mockHttpClient(async () => createHttpResponse(204));
    const url = 'https://api.example.com';

    const result = await testEndpointConnectivity(httpClient, url, {
      detailSuffix: '; credentials resolved from ANTHROPIC_API_KEY.',
    });

    expect(result.ok).toBe(true);
    expect(result.detail).toBe(
      `${url} responded with status 204; credentials resolved from ANTHROPIC_API_KEY.`,
    );
  });
});