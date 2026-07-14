import { obsidianHttpClient } from "@pivi/obsidian-host/obsidianHttpClient";
import type { CustomProviderHttpGet } from "@pivi/pivi-agent-core/engine/pi/installPiCustomProviders";

export const obsidianCustomProviderHttpRequest: CustomProviderHttpGet = async (
  url,
  options,
) => {
  const response = await obsidianHttpClient.fetch({
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
