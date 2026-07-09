import {
  buildSystemPrompt,
  computeSystemPromptKey,
} from '@pivi/pivi-agent-core/prompt';

describe('mainAgent system prompt', () => {
  describe('buildSystemPrompt', () => {
    it('does not include a settings-backed custom instructions section', () => {
      const prompt = buildSystemPrompt();
      expect(prompt).not.toContain('## Custom Instructions');
    });

    it('includes Pivi identity and path conventions', () => {
      const prompt = buildSystemPrompt();
      expect(prompt).toContain('You are **Pivi**');
      expect(prompt).toContain('Knowledge Status');
      expect(prompt).toContain('## Response Language');
      expect(prompt).toContain('same language as the user');
      expect(prompt).toContain('## Path Conventions');
      expect(prompt).toContain('## User Message Format');
      expect(prompt).toContain('<context_files>');
      expect(prompt).toContain('mode: "stats"');
      expect(prompt).toContain('obsidian_markdown_structure');
      expect(prompt).toContain('startLine');
      expect(prompt).toContain('endLine');
      expect(prompt).toContain('same complex task spans multiple distinct context groups');
      expect(prompt).toContain('first assign stable, non-overlapping file/context batches to sub-agents');
      expect(prompt).toContain('If a large file truly must be read in full and sub-agents are available');
      expect(prompt).toContain('prefer spawning a sub-agent with that file as its own context batch');
      expect(prompt).toContain('run_in_background: true');
      expect(prompt).toContain('keep reading, searching, and using tools in the background');
    });

    it('does not advertise external read tools without registered tool context', () => {
      const prompt = buildSystemPrompt();

      expect(prompt).not.toContain('obsidian_read_external');
      expect(prompt).not.toContain('obsidian_list_external');
    });

    it('prioritizes obsidian_edit over obsidian_write overwrite', () => {
      const prompt = buildSystemPrompt();
      expect(prompt).toContain('## Vault mutations (prefer `obsidian_edit` over `obsidian_write`)');
      expect(prompt).toContain('default to `obsidian_edit`');
      expect(prompt).toContain('**Anti-patterns:** `obsidian_read` + `obsidian_write` `overwrite`');
      expect(prompt).toContain('curly quotes');
      expect(prompt).toContain('old_string not found');
    });

    it('guards against accidental Obsidian syntax in generated Markdown', () => {
      const prompt = buildSystemPrompt();
      expect(prompt).toContain('## Obsidian Markdown Hygiene');
      expect(prompt).toContain('Do not write bare `#6`, `#12`, or `#rule`');
      expect(prompt).toContain('Prefer prose such as `rule 6`, `item 6`, `the sixth rule`');
      expect(prompt).toContain('Use Markdown ordered lists (`1.`, `2.`, `3.`)');
      expect(prompt).toContain('Do not use circled/enclosed numerals such as `①`, `②`, `③`');
      expect(prompt).toContain('Use `- [ ]` / `- [x]` only for actionable tasks');
      expect(prompt).toContain('Do not fabricate note paths, headings, block IDs, or embeds');
      expect(prompt).toContain('Preserve existing Dataview, Bases, Canvas, Mermaid');
    });

    it('documents image generation and the openai-codex provider requirement', () => {
      const prompt = buildSystemPrompt();
      expect(prompt).toContain('obsidian_generate_image');
      expect(prompt).toContain('openai-codex');
      expect(prompt).toContain('ChatGPT Plus/Pro Codex');
    });

    it('includes vault path when provided', () => {
      const prompt = buildSystemPrompt({ vaultPath: '/vault/path' });
      expect(prompt).toContain('Vault absolute path: /vault/path');
    });
  });

  describe('userName in system prompt', () => {
    it('includes user context when userName is provided', () => {
      const prompt = buildSystemPrompt({ userName: 'Alice' });
      expect(prompt).toContain('## User Context');
      expect(prompt).toContain('You are collaborating with **Alice**.');
    });

    it('omits user context when userName is empty', () => {
      const prompt = buildSystemPrompt({ userName: '' });
      expect(prompt).not.toContain('## User Context');
    });
  });

  describe('computeSystemPromptKey', () => {
    it('computes key from all settings', () => {
      const key = computeSystemPromptKey({
        vaultPath: '/vault',
        userName: 'Alice',
      });

      expect(key).toBe('/vault::Alice::::');
    });

    it('handles empty values', () => {
      const key = computeSystemPromptKey({
        vaultPath: '',
        userName: '',
      });

      expect(key).toBe('::::::');
    });
  });
});
