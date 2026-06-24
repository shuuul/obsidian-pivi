import {
  buildSystemPrompt,
  computeSystemPromptKey,
} from '../../../../src/core/prompt/mainAgent';

describe('mainAgent system prompt', () => {
  describe('buildSystemPrompt', () => {
    it('does not include a settings-backed custom instructions section', () => {
      const prompt = buildSystemPrompt();
      expect(prompt).not.toContain('## Custom Instructions');
    });

    it('includes Obsius identity and path conventions', () => {
      const prompt = buildSystemPrompt();
      expect(prompt).toContain('You are **Obsius**');
      expect(prompt).toContain('Knowledge Status');
      expect(prompt).toContain('## Path Conventions');
      expect(prompt).toContain('## User Message Format');
      expect(prompt).toContain('<context_files>');
    });

    it('prioritizes obsidian_edit over obsidian_write overwrite', () => {
      const prompt = buildSystemPrompt();
      expect(prompt).toContain('## Vault mutations (prefer `obsidian_edit` over `obsidian_write`)');
      expect(prompt).toContain('default to `obsidian_edit`');
      expect(prompt).toContain('**Anti-patterns:** `obsidian_read` + `obsidian_write` `overwrite`');
      expect(prompt).toContain('curly quotes');
      expect(prompt).toContain('old_string not found');
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
        mediaFolder: 'attachments',
        vaultPath: '/vault',
        userName: 'Alice',
      });

      expect(key).toBe('attachments::/vault::Alice::::');
    });

    it('handles empty values', () => {
      const key = computeSystemPromptKey({
        mediaFolder: '',
        vaultPath: '',
        userName: '',
      });

      expect(key).toBe('::::::::');
    });
  });
});
