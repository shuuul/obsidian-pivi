import type { HttpClient } from '../ports';
import type { ConnectivityTestResult } from './types';

export interface ConnectivityProbeOptions {
  detailSuffix?: string;
  isReachableStatus?: (status: number) => boolean;
}

function defaultReachableStatus(status: number): boolean {
  return status >= 200 && status < 500;
}

export async function testEndpointConnectivity(
  httpClient: HttpClient,
  url: string,
  options: ConnectivityProbeOptions = {},
): Promise<ConnectivityTestResult> {
  const endpoint = url.trim();
  if (!endpoint) {
    return { ok: false, detail: 'No endpoint URL configured.' };
  }

  const isReachableStatus = options.isReachableStatus ?? defaultReachableStatus;
  try {
    const response = await httpClient.fetch({
      url: endpoint,
      method: 'HEAD',
    });
    const suffix = options.detailSuffix ?? '';
    return {
      ok: isReachableStatus(response.status),
      detail: `${endpoint} responded with status ${response.status}${suffix}`,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, detail: `${endpoint}: ${message}` };
  }
}
