import fs from 'node:fs';
import path from 'node:path';

const oldNames = [
  'PiProviderCredentials', 'ProviderSecretStorage', 'AgentEngine',
  'PiAgentEventAdapter', 'PiAiModels', 'PiAuxQueryRunner', 'PiChatRuntime', 'PiChatUIConfig',
  'PiImageContent', 'PiModelEnv', 'PiModelRegistry', 'PiProviderCredentialStore', 'PiProviderOAuthService',
  'PiRuntimeHost', 'PiSettingsCoordinator', 'PiThinkingLevels', 'PiToolAdapter',
  'MessageMapper', 'PiSessionStore', 'SessionTreeStore',
  'McpConfigParser', 'McpServerManager', 'McpStorage',
  'PiMcpBridge', 'PiMcpConnectionPool', 'PiMcpTester',
  'McpAuthFlow', 'McpCallbackServer', 'McpOAuthProvider', 'McpOAuthService', 'McpVaultAuthStore',
  'AgentCoreHost', 'AgentCoreRuntime', 'AuxQueryRunner', 'PiChatService',
  'QueryBackedInlineEditService', 'QueryBackedTitleGenerationService', 'QueuedTurn',
  'RuntimeReadyState', 'StreamChunkQueue',
  'OpenSessionManager', 'ToolSpec', 'ApprovalManager', 'SessionApprovalRules',
  'SlashCommandCatalog', 'SlashCommandEntry', 'VaultSkillsService',
  'AuthContextHost', 'FileStore', 'ObsidianHost', 'ObsidianHttpClient', 'ObsidianVaultApi',
  'ProviderLegacyAuthStore', 'ObsidianCliTransport', 'PiviSettingsStorage',
  'HomeFileAdapter', 'ObsidianVaultFileAdapter', 'SharedStorageService',
];

function walkDir(dir) {
  const files = [];
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
  catch { return files; }
  for (const entry of entries) {
    const fp = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!['node_modules', '.git'].includes(entry.name)) files.push(...walkDir(fp));
    } else if (entry.isFile() && /\.(ts|tsx|mjs|cjs)$/.test(entry.name)) {
      files.push(fp);
    }
  }
  return files;
}

const files = walkDir('.');
let total = 0;
for (const file of files) {
  let content;
  try { content = fs.readFileSync(file, 'utf-8'); } catch { continue; }
  for (const name of oldNames) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp("['\"]([^'\"\\s]*/)?" + escaped + "['\"]", 'g');
    let match;
    while ((match = regex.exec(content)) !== null) {
      const before = content[match.index - 1] || '';
      if (match[1] || before === '.' || before === '/') {
        const line = content.substring(0, match.index).split('\n').length;
        console.log(`${file}:${line}: ${match[0]}`);
        total++;
      }
    }
  }
}

console.log(`\nTotal remaining old-name references: ${total}`);
