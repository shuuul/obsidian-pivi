import { get, request as httpRequest, type IncomingHttpHeaders } from 'http';

import {
  McpCallbackServer,
} from '@pivi/pivi-agent-core/mcp/oauth/mcpCallbackServer';
import {
  OAUTH_CALLBACK_PATH,
} from '@pivi/pivi-agent-core/mcp/oauth/mcpOAuthProvider';

function requestCallback(
  port: number,
  query: string,
  method: string = 'GET',
): Promise<{ statusCode?: number; body: string; headers: IncomingHttpHeaders }> {
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      {
        hostname: 'localhost',
        port,
        path: `${OAUTH_CALLBACK_PATH}${query}`,
        method,
      },
      (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => {
          body += chunk;
        });
        res.on('end', () => resolve({ statusCode: res.statusCode, body, headers: res.headers }));
      },
    );
    req.on('error', reject);
    req.end();
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
  let callbackServer: McpCallbackServer;

  beforeEach(() => {
    callbackServer = new McpCallbackServer();
  });

  afterEach(async () => {
    jest.useRealTimers();
    await callbackServer.stop();
  });

  it('starts, receives a matching callback, and resolves with the authorization code', async () => {
    await callbackServer.ensure();

    const callbackPromise = callbackServer.waitForCallback('state-ok');
    const response = await requestCallback(callbackServer.port, '?state=state-ok&code=auth-code');

    await expect(callbackPromise).resolves.toBe('auth-code');
    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('Authorization Successful');
  });

  it('rejects the pending callback when the provider returns an OAuth error', async () => {
    await callbackServer.ensure();

    const callbackPromise = callbackServer.waitForCallback('state-error');
    const rejection = captureRejection(callbackPromise);
    const response = await requestCallback(
      callbackServer.port,
      '?state=state-error&error=access_denied&error_description=Denied',
    );

    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('Authorization Failed');
    await expect(rejection).resolves.toThrow('Denied');
  });

  it('rejects pending callbacks during cleanup', async () => {
    await callbackServer.ensure();

    const callbackPromise = callbackServer.waitForCallback('state-cleanup');
    const rejection = captureRejection(callbackPromise);
    await callbackServer.stop();

    await expect(rejection).resolves.toThrow('OAuth callback server stopped');
  });

  it('rejects when a callback times out', async () => {
    jest.useFakeTimers();

    const callbackPromise = callbackServer.waitForCallback('state-timeout');
    const rejection = captureRejection(callbackPromise);
    jest.advanceTimersByTime(5 * 60 * 1000);

    await expect(rejection).resolves.toThrow('OAuth callback timeout');
  });

  it('does not complete a flow with an invalid state parameter', async () => {
    await callbackServer.ensure();

    const callbackPromise = callbackServer.waitForCallback('state-valid');
    const response = await requestCallback(
      callbackServer.port,
      '?state=state-invalid&code=auth-code',
    );

    expect(response.statusCode).toBe(400);
    expect(response.body).toContain('Invalid or expired state parameter');

    const rejection = captureRejection(callbackPromise);
    await callbackServer.stop();
    await expect(rejection).resolves.toThrow('OAuth callback server stopped');
  });

  it('returns OAuth provider error text as inert content and applies security headers', async () => {
    await callbackServer.ensure();

    const payload = encodeURIComponent('<script>alert(1)</script><img onerror=alert(1) src=x> " \' &amp;');
    const response = await requestCallback(
      callbackServer.port,
      `?state=state-xss&error=access_denied&error_description=${payload}`,
    );

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-security-policy']).toContain("default-src 'none'");
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.headers['referrer-policy']).toBe('no-referrer');
    expect(response.body).not.toContain('<script>alert(1)</script>');
    expect(response.body).toContain('textContent = detail');
  });

  it('rejects non-GET callback methods without resolving pending authorization', async () => {
    await callbackServer.ensure();

    const callbackPromise = callbackServer.waitForCallback('state-method');
    const rejection = captureRejection(callbackPromise);

    for (const method of ['POST', 'PUT'] as const) {
      const response = await requestCallback(
        callbackServer.port,
        '?state=state-method&code=auth-code',
        method,
      );
      expect(response.statusCode).toBe(405);
      expect(response.body).toContain('Method not allowed');
    }

    await callbackServer.stop();
    await expect(rejection).resolves.toThrow('OAuth callback server stopped');
  });
});
