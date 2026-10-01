/** Vault-local MCP registry for Pivi (never reads ~/.config/mcp or host IDE configs). */
export const PIVI_MCP_CONFIG_PATH = '.pivi/mcp.json';

/** Retired plaintext OAuth directory; startup migrates its entries to SecretStorage and removes it. */
export const PIVI_MCP_OAUTH_DIR = '.pivi/mcp-oauth';
