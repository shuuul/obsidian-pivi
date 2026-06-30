import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'http';

import {
  getConfiguredOAuthCallbackPort,
  getOAuthCallbackPort,
  OAUTH_CALLBACK_PATH,
  setOAuthCallbackPort,
} from './McpOAuthProvider';

const HTML_SUCCESS = `<!DOCTYPE html>
<html>
<head>
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

const htmlError = (error: string): string => `<!DOCTYPE html>
<html>
<head>
  <title>Pivi - Authorization Failed</title>
  <style>
    body { font-family: system-ui, sans-serif; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; background: #1a1a2e; color: #eee; }
    .container { text-align: center; padding: 2rem; }
    h1 { color: #f87171; margin-bottom: 1rem; }
    p { color: #aaa; }
    .error { color: #fca5a5; font-family: monospace; margin-top: 1rem; padding: 1rem; background: rgba(248,113,113,0.1); border-radius: 0.5rem; }
  </style>
</head>
<body>
  <div class="container">
    <h1>Authorization Failed</h1>
    <p>An error occurred during authorization.</p>
    <div class="error">${error}</div>
  </div>
</body>
</html>`;

interface PendingAuth {
  resolve: (code: string) => void;
  reject: (error: Error) => void;
  timeout: number;
}

let server: Server | undefined;
const pendingAuths = new Map<string, PendingAuth>();
const CALLBACK_TIMEOUT_MS = 5 * 60 * 1000;
const MAX_PORT_SCAN_ATTEMPTS = 25;

interface EnsureCallbackServerOptions {
  strictPort?: boolean;
}

function handleRequest(req: IncomingMessage, res: ServerResponse): void {
  const url = new URL(req.url || '/', `http://${req.headers.host}`);

  if (url.pathname !== OAUTH_CALLBACK_PATH) {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not found');
    return;
  }

  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const error = url.searchParams.get('error');
  const errorDescription = url.searchParams.get('error_description');

  if (!state) {
    const errorMsg = 'Missing required state parameter';
    res.writeHead(400, { 'Content-Type': 'text/html' });
    res.end(htmlError(errorMsg));
    return;
  }

  if (error) {
    const errorMsg = errorDescription || error;
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(htmlError(errorMsg));
    if (pendingAuths.has(state)) {
      const pending = pendingAuths.get(state)!;
      window.clearTimeout(pending.timeout);
      pendingAuths.delete(state);
      window.setTimeout(() => pending.reject(new Error(errorMsg)), 0);
    }
    return;
  }

  if (!code) {
    res.writeHead(400, { 'Content-Type': 'text/html' });
    res.end(htmlError('No authorization code provided'));
    return;
  }

  if (!pendingAuths.has(state)) {
    const errorMsg = 'Invalid or expired state parameter';
    res.writeHead(400, { 'Content-Type': 'text/html' });
    res.end(htmlError(errorMsg));
    return;
  }

  const pending = pendingAuths.get(state)!;
  window.clearTimeout(pending.timeout);
  pendingAuths.delete(state);
  pending.resolve(code);

  res.writeHead(200, { 'Content-Type': 'text/html' });
  res.end(HTML_SUCCESS);
}

export async function ensureCallbackServer(options: EnsureCallbackServerOptions = {}): Promise<void> {
  const configuredPort = getConfiguredOAuthCallbackPort();
  const strictPort = options.strictPort === true;

  if (server) {
    if (!strictPort || getOAuthCallbackPort() === configuredPort) {
      return;
    }
    if (pendingAuths.size > 0) {
      throw new Error(
        `OAuth callback server is on port ${getOAuthCallbackPort()}, but port ${configuredPort} is required`,
      );
    }
    await stopCallbackServer();
  }

  const preferredPort = configuredPort;
  const maxAttempts = strictPort ? 1 : MAX_PORT_SCAN_ATTEMPTS;
  let lastError: Error | undefined;

  for (let offset = 0; offset < maxAttempts; offset++) {
    const candidatePort = preferredPort + offset;
    const candidateServer = createServer(handleRequest);

    try {
      await new Promise<void>((resolve, reject) => {
        candidateServer.once('error', (err) => reject(err));
        candidateServer.listen(candidatePort, 'localhost', () => resolve());
      });

      server = candidateServer;
      server.unref();
      setOAuthCallbackPort(candidatePort);
      return;
    } catch (error) {
      const nodeError = error as NodeJS.ErrnoException;
      await new Promise<void>((resolve) => {
        candidateServer.close(() => resolve());
      });
      if (nodeError.code !== 'EADDRINUSE') {
        throw error;
      }
      lastError = error instanceof Error ? error : new Error(String(error));
    }
  }

  if (strictPort) {
    throw new Error(
      `OAuth callback port ${preferredPort} is already in use. Set MCP_OAUTH_CALLBACK_PORT or free the port.`,
      { cause: lastError },
    );
  }

  throw new Error(
    `No free OAuth callback port found near ${preferredPort}`,
    { cause: lastError },
  );
}

export function waitForCallback(oauthState: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      if (pendingAuths.has(oauthState)) {
        pendingAuths.delete(oauthState);
        reject(new Error('OAuth callback timeout - authorization took too long'));
      }
    }, CALLBACK_TIMEOUT_MS);

    pendingAuths.set(oauthState, { resolve, reject, timeout });
  });
}

export function cancelPendingCallback(oauthState: string): void {
  const pending = pendingAuths.get(oauthState);
  if (pending) {
    window.clearTimeout(pending.timeout);
    pendingAuths.delete(oauthState);
    pending.reject(new Error('Authorization cancelled'));
  }
}

export async function stopCallbackServer(): Promise<void> {
  if (server) {
    await new Promise<void>((resolve) => {
      server!.close(() => resolve());
    });
    server = undefined;
  }

  setOAuthCallbackPort(getConfiguredOAuthCallbackPort());

  const pendingList = Array.from(pendingAuths.entries());
  pendingAuths.clear();
  window.setTimeout(() => {
    for (const [, pending] of pendingList) {
      window.clearTimeout(pending.timeout);
      pending.reject(new Error('OAuth callback server stopped'));
    }
  }, 0);
}
