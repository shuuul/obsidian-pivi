import type { ExternalOpener } from '@pivi/pivi-agent-core/ports';

/** Open an MCP OAuth authorization URL through the host-provided external opener. */
export function openAuthUrl(url: string, opener: ExternalOpener): Promise<void> {
  return opener.openExternalUrl(url);
}
