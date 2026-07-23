import type { CustomProviderHttpGet } from "@pivi/pivi-agent-core/engine/pi/installPiCustomProviders";
import type { HttpClient } from "@pivi/pivi-agent-core/ports";

export function createCustomProviderHttpRequest(httpClient: HttpClient): CustomProviderHttpGet {
  return async (url, options) => {
    const response = await httpClient.fetch({
      url,
      method: options?.method ?? "GET",
      headers: options?.headers,
      body: options?.body,
    });
    return {
      status: response.status,
      body: await response.text(),
    };
  };
}
