import { requestUrl } from 'obsidian';

import { obsidianHttpClient } from '@pivi/obsidian-host/ObsidianHttpClient';

const requestUrlMock = requestUrl as jest.MockedFunction<typeof requestUrl>;

describe('obsidianHttpClient', () => {
  afterEach(() => {
    requestUrlMock.mockReset();
    requestUrlMock.mockResolvedValue({ status: 200, headers: {} } as never);
  });

  it('delegates fetch to requestUrl with throw disabled', async () => {
    requestUrlMock.mockResolvedValue({ status: 204, headers: { 'x-test': '1' } } as never);

    const response = await obsidianHttpClient.fetch({
      url: 'https://api.example.com',
      method: 'HEAD',
      headers: { Authorization: 'Bearer token' },
    });

    expect(requestUrlMock).toHaveBeenCalledWith({
      url: 'https://api.example.com',
      method: 'HEAD',
      headers: { Authorization: 'Bearer token' },
      body: undefined,
      throw: false,
    });
    expect(response.status).toBe(204);
    expect(response.ok).toBe(true);
    expect(response.headers).toEqual({ 'x-test': '1' });
  });

  it('marks sub-300 responses as ok and 4xx/5xx as not ok', async () => {
    requestUrlMock.mockResolvedValue({ status: 404, headers: {} } as never);

    const response = await obsidianHttpClient.fetch({
      url: 'https://api.example.com',
      method: 'HEAD',
    });

    expect(response.status).toBe(404);
    expect(response.ok).toBe(false);
  });

  it('returns requestUrl text from response.text()', async () => {
    requestUrlMock.mockResolvedValue({
      status: 200,
      headers: {},
      text: '{"sha":"deadbeef"}',
    } as never);

    const response = await obsidianHttpClient.fetch({
      url: 'https://api.example.com/commits',
      method: 'GET',
    });

    await expect(response.text()).resolves.toBe('{"sha":"deadbeef"}');
  });

  it('returns requestUrl json from response.json() when json is present', async () => {
    const payload = { sha: 'from-json-field' };
    requestUrlMock.mockResolvedValue({
      status: 200,
      headers: {},
      text: '{"sha":"from-text"}',
      json: payload,
    } as never);

    const response = await obsidianHttpClient.fetch({
      url: 'https://api.example.com/commits',
      method: 'GET',
    });

    await expect(response.json<{ sha: string }>()).resolves.toEqual({ sha: 'from-json-field' });
  });

  it('parses requestUrl text in response.json() when json is absent', async () => {
    requestUrlMock.mockResolvedValue({
      status: 200,
      headers: {},
      text: '{"sha":"parsed-from-text"}',
    } as never);

    const response = await obsidianHttpClient.fetch({
      url: 'https://api.example.com/commits',
      method: 'GET',
    });

    await expect(response.json<{ sha: string }>()).resolves.toEqual({ sha: 'parsed-from-text' });
  });

  it('propagates requestUrl rejections to callers', async () => {
    requestUrlMock.mockRejectedValue(new Error('offline'));

    await expect(
      obsidianHttpClient.fetch({ url: 'https://api.example.com', method: 'HEAD' }),
    ).rejects.toThrow('offline');
  });
});