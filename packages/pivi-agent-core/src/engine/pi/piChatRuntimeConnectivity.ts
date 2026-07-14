import type { HttpClient } from '../../ports';
import { testEndpointConnectivity } from '../../runtime/connectivity';
import type { ConnectivityTestResult } from '../../runtime/types';
import type { resolvePiModel } from './piModelEnv';

export async function testPiChatConnectivity(
  httpClient: HttpClient,
  model: ReturnType<typeof resolvePiModel>,
  auth: unknown,
): Promise<ConnectivityTestResult> {
  if (!model) {
    return { ok: false, detail: 'No model configured.' };
  }

  const provider = model.provider;
  if (!auth) {
    return { ok: false, detail: `No credentials for provider: ${provider}` };
  }

  const baseUrl = model.baseUrl as string | undefined;
  if (!baseUrl) {
    return { ok: false, detail: 'Model has no baseUrl configured.' };
  }

  return testEndpointConnectivity(httpClient, baseUrl, {
    isReachableStatus: () => true,
  });
}
