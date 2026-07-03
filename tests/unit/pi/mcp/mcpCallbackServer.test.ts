import { get } from 'http';

import {
  ensureCallbackServer,
  stopCallbackServer,
  waitForCallback,
} from '@pivi/pivi-agent-core/mcp/oauth/mcpCallbackServer';
import {
  getOAuthCallbackPort,
  OAUTH_CALLBACK_PATH,
} from '@pivi/pivi-agent-core/mcp/oauth/mcpOAuthProvider';

function requestCallback(query: string): Promise<{ statusCode?: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = get(
      `http://localhost:${getOAuthCallbackPort()}${OAUTH_CALLBACK_PATH}${query}`,
      (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => {
          body += chunk;
        });
        res.on('end', () => resolve({ statusCode: res.statusCode, body }));
      },
    );
    req.on('error', reject);
  });
}

function captureRejection<T>(promise: Promise<T>): Promise<Error> {
  return promise.then(
    () => {
      throw new Error('Expected promise to reject');
    },
    (error: unknown) => error instanceof Error ? error : new Error(String(error)),
  );
}

describe('McpCallbackServer', () => {
  afterEach(async () => {
    jest.useRealTimers();
    await stopCallbackServer();
  });

  it('starts, receives a matching callback, and resolves with the authorization code', async () => {
    await ensureCallbackServer();

    const callbackPromise = waitForCallback('state-ok');
    const response = await requestCallback('?state=state-ok&code=auth-code');

    await expect(callbackPromise).resolves.toBe('auth-code');
    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('Authorization Successful');
  });

  it('rejects the pending callback when the provider returns an OAuth error', async () => {
    await ensureCallbackServer();

    const callbackPromise = waitForCallback('state-error');
    const rejection = captureRejection(callbackPromise);
    const response = await requestCallback('?state=state-error&error=access_denied&error_description=Denied');

    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('Authorization Failed');
    await expect(rejection).resolves.toThrow('Denied');
  });

  it('rejects pending callbacks during cleanup', async () => {
    await ensureCallbackServer();

    const callbackPromise = waitForCallback('state-cleanup');
    const rejection = captureRejection(callbackPromise);
    await stopCallbackServer();

    await expect(rejection).resolves.toThrow('OAuth callback server stopped');
  });

  it('rejects when a callback times out', async () => {
    jest.useFakeTimers();

    const callbackPromise = waitForCallback('state-timeout');
    const rejection = captureRejection(callbackPromise);
    jest.advanceTimersByTime(5 * 60 * 1000);

    await expect(rejection).resolves.toThrow('OAuth callback timeout');
  });

  it('does not complete a flow with an invalid state parameter', async () => {
    await ensureCallbackServer();

    const callbackPromise = waitForCallback('state-valid');
    const response = await requestCallback('?state=state-invalid&code=auth-code');

    expect(response.statusCode).toBe(400);
    expect(response.body).toContain('Invalid or expired state parameter');

    const rejection = captureRejection(callbackPromise);
    await stopCallbackServer();
    await expect(rejection).resolves.toThrow('OAuth callback server stopped');
  });
});
