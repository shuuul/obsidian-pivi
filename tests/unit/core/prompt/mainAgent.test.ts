import {
  buildSystemPrompt,
  computeSystemPromptKey,
} from '../../../../src/core/prompt/mainAgent';

describe('mainAgent system prompt', () => {
  describe('buildSystemPrompt', () => {
    it('appends custom prompt section when provided', () => {
      const prompt = buildSystemPrompt({ customPrompt: 'Always be concise.' });
      expect(prompt).toContain('## Custom Instructions');
      expect(prompt).toContain('Always be concise.');
    });

    it('does not append custom prompt section when empty', () => {
      const prompt = buildSystemPrompt({ customPrompt: '   ' });
      expect(prompt).not.toContain('## Custom Instructions');
    });

    it('includes Obsius identity and path conventions', () => {
      const prompt = buildSystemPrompt();
      expect(prompt).toContain('You are **Obsius**');
      expect(prompt).toContain('Use `bash: date` to get the current date and time. Never guess or assume.');
      expect(prompt).toContain('## Path Conventions');
      expect(prompt).toContain('## User Message Format');
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
        customPrompt: 'Be helpful',
        vaultPath: '/vault',
        userName: 'Alice',
      });

      expect(key).toBe('attachments::Be helpful::/vault::Alice');
    });

    it('handles empty values', () => {
      const key = computeSystemPromptKey({
        mediaFolder: '',
        customPrompt: '',
        vaultPath: '',
        userName: '',
      });

      expect(key).toBe('::::::');
    });
  });
});
