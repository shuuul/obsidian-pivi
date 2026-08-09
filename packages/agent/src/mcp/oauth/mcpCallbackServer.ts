import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'http';

import {
  DEFAULT_OAUTH_CALLBACK_PORT,
  OAUTH_CALLBACK_PATH,
  validateOAuthCallbackPort,
} from './mcpOAuthProvider';

const CALLBACK_SECURITY_HEADERS = {
  'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'",
  'X-Content-Type-Options': 'nosniff',
  'Cache-Control': 'no-store',
  'Referrer-Policy': 'no-referrer',
} as const;

const HTML_SUCCESS = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Pivi - Authorization Successful</title>
  <style>
    body { font-family: system-ui, sans-serif; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; background: #1a1a2e; color: #eee; }
    .container { text-align: center; padding: 2rem; }
    h1 { color: #4ade80; margin-bottom: 1rem; }
    p { color: #aaa; }
  </style>
</head>
<body>
  <div class="container">
    <h1>Authorization Successful</h1>
    <p>You can close this window and return to Pivi.</p>
  </div>
  <script>setTimeout(() => window.close(), 2000);</script>
</body>
</html>`;

const HTML_ERROR = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Pivi - Authorization Failed</title>
  <style>
    body { font-family: system-ui, sans-serif; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; background: #1a1a2e; color: #eee; }
    .container { text-align: center; padding: 2rem; }
    h1 { color: #f87171; margin-bottom: 1rem; }
    p { color: #aaa; }
    .error { color: #fca5a5; font-family: monospace; margin-top: 1rem; padding: 1rem; background: rgba(248,113,113,0.1); border-radius: 0.5rem; white-space: pre-wrap; }
  </style>
</head>
<body>
  <div class="container">
    <h1>Authorization Failed</h1>
    <p>An error occurred during authorization.</p>
    <div class="error" id="error-detail"></div>
  </div>
  <script>
    const params = new URLSearchParams(window.location.search);
    const detail = params.get('error_description') || params.get('error') || 'Authorization failed';
    document.getElementById('error-detail').textContent = detail;
  </script>
</body>
</html>`;

function writeResponse(
  res: ServerResponse,
  statusCode: number,
  contentType: string,
  body: string,
): void {
  res.writeHead(statusCode, {
    ...CALLBACK_SECURITY_HEADERS,
    'Content-Type': contentType,
  });
  res.end(body);
}

interface PendingAuth {
  resolve: (code: string) => void;
  reject: (error: Error) => void;
  timeout: number;
}

const CALLBACK_TIMEOUT_MS = 5 * 60 * 1000;
const MAX_PORT_SCAN_ATTEMPTS = 25;

interface EnsureCallbackServerOptions {
  strictPort?: boolean;
}

function handleRequest(
  pendingAuths: Map<string, PendingAuth>,
  req: IncomingMessage,
  res: ServerResponse,
): void {
  if (req.method !== 'GET') {
    writeResponse(res, 405, 'text/plain; charset=utf-8', 'Method not allowed');
    return;
  }

  const url = new URL(req.url || '/', `http://${req.headers.host}`);

  if (url.pathname !== OAUTH_CALLBACK_PATH) {
    writeResponse(res, 404, 'text/plain; charset=utf-8', 'Not found');
    return;
  }

  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const error = url.searchParams.get('error');
  const errorDescription = url.searchParams.get('error_description');

  if (!state) {
    writeResponse(res, 400, 'text/plain; charset=utf-8', 'Missing required state parameter');
    return;
  }

  if (error) {
    const errorMsg = errorDescription || error;
    writeResponse(res, 200, 'text/html; charset=utf-8', HTML_ERROR);
    if (pendingAuths.has(state)) {
      const pending = pendingAuths.get(state)!;
      window.clearTimeout(pending.timeout);
      pendingAuths.delete(state);
      window.setTimeout(() => pending.reject(new Error(errorMsg)), 0);
    }
    return;
  }

  if (!code) {
    writeResponse(res, 400, 'text/plain; charset=utf-8', 'No authorization code provided');
    return;
  }

  if (!pendingAuths.has(state)) {
    writeResponse(res, 400, 'text/plain; charset=utf-8', 'Invalid or expired state parameter');
    return;
  }

  const pending = pendingAuths.get(state)!;
  window.clearTimeout(pending.timeout);
  pendingAuths.delete(state);
  pending.resolve(code);

  writeResponse(res, 200, 'text/html; charset=utf-8', HTML_SUCCESS);
}

export class McpCallbackServer {
  private server: Server | undefined;
  private readonly pendingAuths = new Map<string, PendingAuth>();
  readonly configuredPort: number;
  private activePort: number;

  constructor(configuredPort: number | undefined = DEFAULT_OAUTH_CALLBACK_PORT) {
    this.configuredPort = validateOAuthCallbackPort(configuredPort);
    this.activePort = this.configuredPort;
  }

  get port(): number {
    return this.activePort;
  }

  async ensure(options: EnsureCallbackServerOptions = {}): Promise<void> {
    const strictPort = options.strictPort === true;

    if (this.server) {
      if (!strictPort || this.activePort === this.configuredPort) {
        return;
      }
      if (this.pendingAuths.size > 0) {
        throw new Error(
          `OAuth callback server is on port ${this.activePort}, but port ${this.configuredPort} is required`,
        );
      }
      await this.stop();
    }

    const maxAttempts = strictPort ? 1 : MAX_PORT_SCAN_ATTEMPTS;
    let lastError: Error | undefined;

    for (let offset = 0; offset < maxAttempts; offset++) {
      const candidatePort = this.configuredPort + offset;
      const candidateServer = createServer((req, res) => handleRequest(this.pendingAuths, req, res));

      try {
        const { promise, resolve, reject } = createPromiseResolvers<void>();
        candidateServer.once('error', reject);
        candidateServer.listen(candidatePort, 'localhost', resolve);
        await promise;

        this.server = candidateServer;
        this.server.unref();
        this.activePort = candidatePort;
        return;
      } catch (error) {
        const nodeError = error as NodeJS.ErrnoException;
        const { promise, resolve } = createPromiseResolvers<void>();
        candidateServer.close(() => resolve());
        await promise;
        if (nodeError.code !== 'EADDRINUSE') {
          throw error;
        }
        lastError = error instanceof Error ? error : new Error(String(error));
      }
    }

    if (strictPort) {
      throw new Error(
        `OAuth callback port ${this.configuredPort} is already in use. Set MCP_OAUTH_CALLBACK_PORT or free the port.`,
        { cause: lastError },
      );
    }

    throw new Error(
      `No free OAuth callback port found near ${this.configuredPort}`,
      { cause: lastError },
    );
  }

  waitForCallback(oauthState: string): Promise<string> {
    const { promise, resolve, reject } = createPromiseResolvers<string>();
    const timeout = window.setTimeout(() => {
      if (this.pendingAuths.has(oauthState)) {
        this.pendingAuths.delete(oauthState);
        reject(new Error('OAuth callback timeout - authorization took too long'));
      }
    }, CALLBACK_TIMEOUT_MS);

    this.pendingAuths.set(oauthState, { resolve, reject, timeout });
    return promise;
  }

  cancelPendingCallback(oauthState: string): void {
    const pending = this.pendingAuths.get(oauthState);
    if (pending) {
      window.clearTimeout(pending.timeout);
      this.pendingAuths.delete(oauthState);
      pending.reject(new Error('Authorization cancelled'));
    }
  }

  async stop(): Promise<void> {
    if (this.server) {
      const { promise, resolve } = createPromiseResolvers<void>();
      this.server.close(() => resolve());
      await promise;
      this.server = undefined;
    }

    this.activePort = this.configuredPort;

    const pendingList = Array.from(this.pendingAuths.values());
    this.pendingAuths.clear();
    window.setTimeout(() => {
      for (const pending of pendingList) {
        window.clearTimeout(pending.timeout);
        pending.reject(new Error('OAuth callback server stopped'));
      }
    }, 0);
  }
}

function createPromiseResolvers<T>(): {
  promise: Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
  reject: (reason?: unknown) => void;
} {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, resolve, reject };
}
