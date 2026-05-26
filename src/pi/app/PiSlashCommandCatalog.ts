import type { TAbstractFile } from 'obsidian';

import type { SlashCommandCatalog, SlashCommandDropdownConfig } from '../../core/agent/commands/SlashCommandCatalog';
import type { SlashCatalogEntry } from '../../core/agent/commands/SlashCommandEntry';
import type { VaultFileAdapter } from '../../core/storage/VaultFileAdapter';
import type { SlashCommand } from '../../core/types';
import type ObsiusPlugin from '../../main';

/**
 * Parses simple markdown templates containing optional YAML frontmatter.
 */
export function parseMarkdownTemplate(content: string): { frontmatter: Record<string, string>; body: string } {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!match) {
    return { frontmatter: {}, body: content.trim() };
  }
  const fmText = match[1];
  const body = match[2].trim();
  const frontmatter: Record<string, string> = {};

  const lines = fmText.split(/\r?\n/);
  for (const line of lines) {
    const colonIndex = line.indexOf(':');
    if (colonIndex !== -1) {
      const key = line.substring(0, colonIndex).trim();
      const val = line.substring(colonIndex + 1).trim();
      // Remove optional surrounding quotes
      const cleanVal = val.replace(/^["']|["']$/g, '');
      frontmatter[key] = cleanVal;
    }
  }
  return { frontmatter, body };
}

export class PiSlashCommandCatalog implements SlashCommandCatalog {
  private vaultEntries: SlashCatalogEntry[] = [];
  private runtimeCommands: SlashCatalogEntry[] = [];
  private isWatching = false;

  constructor(
    private readonly plugin: ObsiusPlugin,
    private readonly adapter: VaultFileAdapter,
  ) {
    this.registerVaultWatcher();
  }

  private registerVaultWatcher(): void {
    if (this.isWatching) return;
    this.isWatching = true;

    const isTemplatePath = (path: string) => path.startsWith('.obsius/templates/') && path.endsWith('.md');

    this.plugin.registerEvent(
      this.plugin.app.vault.on('create', (file: TAbstractFile) => {
        if (isTemplatePath(file.path)) {
          void this.refresh();
        }
      })
    );

    this.plugin.registerEvent(
      this.plugin.app.vault.on('modify', (file: TAbstractFile) => {
        if (isTemplatePath(file.path)) {
          void this.refresh();
        }
      })
    );

    this.plugin.registerEvent(
      this.plugin.app.vault.on('delete', (file: TAbstractFile) => {
        if (isTemplatePath(file.path)) {
          void this.refresh();
        }
      })
    );

    this.plugin.registerEvent(
      this.plugin.app.vault.on('rename', (file: TAbstractFile, oldPath: string) => {
        if (isTemplatePath(file.path) || isTemplatePath(oldPath)) {
          void this.refresh();
        }
      })
    );
  }

  async listDropdownEntries(context: { includeBuiltIns: boolean }): Promise<SlashCatalogEntry[]> {
    if (this.vaultEntries.length === 0) {
      await this.refresh();
    }
    const combined = [...this.vaultEntries];
    
    // Add default create-command entry
    combined.push({
      id: 'create-command',
      kind: 'command',
      name: 'create-command',
      description: 'Create a custom slash command / prompt template',
      content: '',
      argumentHint: '',
      scope: 'builtin',
      source: 'builtin',
      isEditable: false,
      isDeletable: false,
      displayPrefix: '/',
      insertPrefix: '/',
    });

    if (context.includeBuiltIns) {
      combined.push(...this.runtimeCommands);
    }
    return combined;
  }

  async listVaultEntries(): Promise<SlashCatalogEntry[]> {
    if (this.vaultEntries.length === 0) {
      await this.refresh();
    }
    return this.vaultEntries;
  }

  async saveVaultEntry(entry: SlashCatalogEntry): Promise<void> {
    await this.adapter.ensureFolder('.obsius/templates');
    const path = `.obsius/templates/${entry.id}.md`;
    const frontmatter = `---
description: ${entry.description ?? ''}
argumentHint: ${entry.argumentHint ?? ''}
---
${entry.content}`;
    await this.adapter.write(path, frontmatter);
    await this.refresh();
  }

  async deleteVaultEntry(entry: SlashCatalogEntry): Promise<void> {
    const path = `.obsius/templates/${entry.id}.md`;
    if (await this.adapter.exists(path)) {
      await this.adapter.delete(path);
    }
    await this.refresh();
  }

  setRuntimeCommands(commands: SlashCommand[]): void {
    this.runtimeCommands = commands.map((cmd) => ({
      id: cmd.id,
      kind: cmd.kind ?? 'command',
      name: cmd.name,
      description: cmd.description,
      content: cmd.content,
      argumentHint: cmd.argumentHint,
      allowedTools: cmd.allowedTools,
      model: cmd.model,
      disableModelInvocation: cmd.disableModelInvocation,
      userInvocable: cmd.userInvocable,
      context: cmd.context,
      agent: cmd.agent,
      hooks: cmd.hooks,
      scope: 'runtime',
      source: cmd.source ?? 'sdk',
      isEditable: false,
      isDeletable: false,
      displayPrefix: '/',
      insertPrefix: '/',
    }));
  }

  getDropdownConfig(): SlashCommandDropdownConfig {
    return {
      triggerChars: ['/'],
      builtInPrefix: '/',
      skillPrefix: '/',
      commandPrefix: '/',
    };
  }

  async refresh(): Promise<void> {
    try {
      await this.adapter.ensureFolder('.obsius/templates');
      const files = await this.adapter.listFiles('.obsius/templates');
      const mdFiles = files.filter((f) => f.endsWith('.md'));

      const entries: SlashCatalogEntry[] = [];
      for (const file of mdFiles) {
        try {
          const content = await this.adapter.read(file);
          const { frontmatter, body } = parseMarkdownTemplate(content);

          const parts = file.split('/');
          const filename = parts[parts.length - 1];
          const id = filename.substring(0, filename.lastIndexOf('.md'));

          entries.push({
            id,
            kind: 'command',
            name: id,
            description: frontmatter.description ?? `Custom template from ${filename}`,
            content: body,
            argumentHint: frontmatter.argumentHint ?? 'text',
            scope: 'vault',
            source: 'user',
            isEditable: true,
            isDeletable: true,
            displayPrefix: '/',
            insertPrefix: '/',
            persistenceKey: `vault:${id}`,
          });
        } catch (e) {
          console.error(`Obsius: Failed to parse template ${file}:`, e);
        }
      }
      this.vaultEntries = entries;
    } catch (e) {
      console.error('Obsius: Failed to refresh slash command catalog:', e);
    }
  }
}
