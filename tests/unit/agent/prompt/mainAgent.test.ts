import {
  buildSystemPrompt,
  computeSystemPromptKey,
} from '@pivi/agent/prompt';

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
      expect(prompt).toContain('If one physical line is oversized');
      expect(prompt).toContain('`startLine` with line-relative `startChar` and `maxChars`');
      expect(prompt).toContain('exact returned `nextStartLine` + `nextStartChar` pair');
      expect(prompt).toContain('A standalone `startChar` remains file-global');
      expect(prompt).toContain('never calculate offsets, overlap pages, or raise the budget');
      expect(prompt).toContain('split the complete list into balanced, stable, non-overlapping batches');
      expect(prompt).toContain('Before those workers report back');
      expect(prompt).toContain('If a large file truly must be read in full and sub-agents are available');
      expect(prompt).toContain('prefer spawning a sub-agent with that file as its own context batch');
      expect(prompt).toContain('run_in_background: true');
      expect(prompt).toContain('keep reading, searching, and using tools in the background');
      expect(prompt).toContain('asks for, allows, or says you can/may use sub-agents');
      expect(prompt).toContain('emit multiple background `spawn_agent` calls together');
      expect(prompt).toContain('up to the live maximum stated under Available Tools');
      expect(prompt).toContain('do not start only one worker');
    });

    it('does not advertise external read tools without registered tool context', () => {
      const prompt = buildSystemPrompt();

      expect(prompt).not.toContain('obsidian_read_external');
      expect(prompt).not.toContain('obsidian_list_external');
    });

    it('composes capability-aware registered guidance without weakening general principles', () => {
      const prompt = buildSystemPrompt({}, {
        registeredToolNames: ['obsidian_read'],
        registeredToolsSection: '## Available Tools\n- `obsidian_read` — read marker',
      });

      expect(prompt).toContain('`obsidian_read` — read marker');
      expect(prompt).not.toContain('obsidian_edit');
      expect(prompt).not.toContain('pivi_sessions');
      expect(prompt).not.toContain('spawn_agent');
      expect(prompt).toContain('## Obsidian Markdown Hygiene');
      expect(prompt).toContain('**Safety First**');
    });

    it('prioritizes narrow exact mutations over full-note overwrite', () => {
      const prompt = buildSystemPrompt();
      expect(prompt).toContain('## Vault mutations (use the narrowest exact mutation)');
      expect(prompt).toContain('`obsidian_edit` for exact local replacement, including inserting line endings');
      expect(prompt).toContain('Do not match the whole line');
      expect(prompt).toContain('shortest unique local span across the desired boundary');
      expect(prompt).toContain('`sentence.Second` → `sentence.\\n\\nSecond`');
      expect(prompt).toContain('replace `>>` with `\\n\\n` to remove it or `\\n\\n>>`');
      expect(prompt).toContain('Use `replace_all: true` only when every exact occurrence should receive the identical replacement');
      expect(prompt).toContain('**Markdown block boundaries with `obsidian_edit`:** Replacement is literal');
      expect(prompt).toContain('replacing only `Target` with `### Heading` produces `>> ### Heading`, not a heading');
      expect(prompt).toContain('put the required `\\n\\n` in `new_string`');
      expect(prompt).toContain('read back the changed span and verify the rendered structure');
      expect(prompt).toContain('**Anti-patterns:** `obsidian_read` + `obsidian_write` `overwrite`');
      expect(prompt).toContain('curly quotes');
      expect(prompt).toContain('old_string not found');
    });

    it('requires stable and verified vault note links', () => {
      const prompt = buildSystemPrompt();

      expect(prompt).toContain('already present in one or more vault notes');
      expect(prompt).toContain('do not repeat, quote, or summarize that note content');
      expect(prompt).toContain('Return only the corresponding verified wikilinks');
      expect(prompt).toContain('Treat each link insertion as a verified edit');
      expect(prompt).toContain('Read the source note immediately before editing');
      expect(prompt).toContain('read back the changed span and confirm the exact link appears once');
      expect(prompt).toContain('edit and verify each file independently');
      expect(prompt).toContain('Build every link from the exact vault-relative path');
      expect(prompt).toContain('[[exact/path|alias]]');
      expect(prompt).toContain('Keep the full directory path when listing many notes');
      expect(prompt).toContain('Never split a wikilink across lines');
      expect(prompt).toContain('do not present an unresolved guess as clickable');
      expect(prompt).toContain('Treat sub-agent and tool output as candidate data');
      expect(prompt).toContain('deterministically deduplicate them');
      expect(prompt).toContain('compute every claimed count from that final distinct list');
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
            expect(prompt).toContain('Math delimiters are intentional only');
            expect(prompt).toContain('single `$...$` for inline math and double `$$...$$` for block/display math');
    });

    it('documents image generation and the openai-codex provider requirement', () => {
      const prompt = buildSystemPrompt();
      expect(prompt).toContain('obsidian_generate_image');
      expect(prompt).toContain('openai-codex');
      expect(prompt).toContain('ChatGPT Plus/Pro Codex');
      expect(prompt).toContain('![](assets/image.png)');
      expect(prompt).not.toContain('![[assets/image.png]]');
    });

    it('does not expose the vault filesystem path', () => {
      const prompt = buildSystemPrompt({ vaultPath: '/vault/path' });
      expect(prompt).not.toContain('Vault absolute path:');
      expect(prompt).not.toContain('/vault/path');
      expect(prompt).toContain('/absolute/device/path/file.md');
      expect(prompt).toContain('never use external-path tools for files inside the vault');
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
