import {
  buildRegisteredToolsSection,
} from '@pivi/pivi-agent-core/prompt';
import {
  OBSIDIAN_AGENT_TOOLS,
  OBSIDIAN_OPTIONAL_TOOLS,
  TOOL_OBSIDIAN_BASE,
  TOOL_OBSIDIAN_DELETE,
  TOOL_OBSIDIAN_BASH,
  TOOL_OBSIDIAN_COMMAND,
  TOOL_OBSIDIAN_DAILY,
  TOOL_OBSIDIAN_EVAL,
  TOOL_OBSIDIAN_GRAPH,
  TOOL_OBSIDIAN_HISTORY,
  TOOL_OBSIDIAN_LINKS,
  TOOL_OBSIDIAN_LIST_EXTERNAL,
  TOOL_OBSIDIAN_MARKDOWN_STRUCTURE,
  TOOL_OBSIDIAN_MKDIR,
  TOOL_OBSIDIAN_MOVE,
  TOOL_OBSIDIAN_NOTE_INFO,
  TOOL_OBSIDIAN_READ,
  TOOL_OBSIDIAN_READ_EXTERNAL,
  TOOL_OBSIDIAN_SEARCH,
  TOOL_OBSIDIAN_TAGS,
  TOOL_SPAWN_AGENT,
} from '@pivi/pivi-agent-core/tools';

function buildSection(overrides: Partial<Parameters<typeof buildRegisteredToolsSection>[0]> = {}): string {
  return buildRegisteredToolsSection({
    obsidianTools: [],
    obsidianCliAvailable: true,
    includeMcp: false,
    includeSkill: false,
    includeSubagent: false,
    includeWebSearch: false,
    ...overrides,
  });
}

const removedGatePhrase = ['requires', 'ap' + 'proval'].join(' ');

describe('obsidian registered tool prompt section', () => {
  it('documents every registered Obsidian tool parameter in the vault prompt', () => {
    const tools = [...OBSIDIAN_AGENT_TOOLS, ...OBSIDIAN_OPTIONAL_TOOLS];
    const section = buildSection({ obsidianTools: tools });
    const lines = section.split('\n');
    const lineFor = (toolName: string): string => {
      const line = lines.find((candidate) => candidate.startsWith(`- \`${toolName}\``));
      if (!line) {
        throw new Error(`Missing prompt line for ${toolName}`);
      }
      return line;
    };

    for (const toolName of tools) {
      expect(lineFor(toolName)).toContain('Parameters:');
    }

    const expectedParams: Record<string, readonly string[]> = {
      obsidian_read: ['`file?`', '`path?`', '`mode?`', '`startLine?`', '`endLine?`', '`maxChars?`'],
      obsidian_markdown_structure: ['`file?`', '`path?`', '`maxHeadings?`'],
      obsidian_edit: ['`old_string`', '`new_string`', '`file?`', '`path?`', '`replace_all?`'],
      obsidian_write: ['`content`', '`mode`', '`file?`', '`path?`', '`overwrite?`'],
      obsidian_search: ['`query`', '`path?`', '`limit?`', '`context?`', '`format?`'],
      obsidian_note_info: ['`file?`', '`path?`', '`action?`', '`limit?`'],
      obsidian_links: ['`file?`', '`path?`', '`direction?`', '`format?`'],
      obsidian_properties: ['`action`', '`name?`', '`value?`', '`file?`', '`path?`'],
      obsidian_tasks: ['`action`', '`file?`', '`path?`', '`line?`', '`ref?`', '`daily?`', '`todo?`', '`done?`'],
      obsidian_history: ['`action`', '`path?`', '`version?`'],
      obsidian_delete: ['`file?`', '`path?`'],
      obsidian_move: ['`path`', '`newPath`'],
      obsidian_list: ['`path?`'],
      obsidian_mkdir: ['`path`'],
      obsidian_open: ['`path`', '`target?`'],
      obsidian_attachment: ['`path?`', '`filename?`', '`sourcePath?`'],
      obsidian_generate_image: ['`prompt`', '`model?`', '`outputFormat?`', '`filename?`', '`sourcePath?`', '`insertInto?`', '`insertMode?`', '`old_string?`'],
      obsidian_daily: ['`action`', '`content?`', '`inline?`'],
      obsidian_graph: ['`actions?`', '`limit?`', '`includeNonMarkdown?`'],
      obsidian_tags: ['`action`', '`name?`', '`sort?`', '`verbose?`'],
      obsidian_base: ['`action`', '`file?`', '`path?`', '`view?`', '`format?`'],
      obsidian_read_external: ['`path`', '`mode?`', '`startLine?`', '`endLine?`', '`maxChars?`'],
      obsidian_list_external: ['`path`'],
      obsidian_command: ['`id`'],
      obsidian_bash: ['`command`', '`cwd?`'],
      obsidian_eval: ['`code`'],
    };

    for (const [toolName, params] of Object.entries(expectedParams)) {
      const line = lineFor(toolName);
      for (const param of params) {
        expect(line).toContain(param);
      }
    }
  });

  it('documents generated images as standard Markdown embeds', () => {
    const section = buildSection({ obsidianTools: ['obsidian_generate_image'] });

    expect(section).toContain('![](assets/image.png)');
    expect(section).not.toContain('![[image]]');
  });

  it('documents obsidian_history and its recovery workflow', () => {
    const section = buildSection({ obsidianTools: [TOOL_OBSIDIAN_HISTORY] });

    expect(section).toContain('obsidian_history');
    expect(section).toContain('Use `obsidian_history` before giving up on a deleted, overwritten, or accidentally changed vault note');
    expect(section).toContain('action: "files"');
    expect(section).toContain('action: "list"');
    expect(section).toContain('action: "read"');
    expect(section).toContain('action: "restore"');
    expect(section).toContain('History restore depends on Obsidian’s stored history');
  });

  it('does not recommend history recovery when obsidian_history is not registered or CLI is unavailable', () => {
    expect(buildSection({ obsidianTools: [] }))
      .not.toContain('Use `obsidian_history` before giving up');

    const withoutCli = buildSection({
      obsidianTools: [TOOL_OBSIDIAN_HISTORY],
      obsidianCliAvailable: false,
    });

    expect(withoutCli).toContain('obsidian_history');
    expect(withoutCli).toContain('CLI-only history recovery is unavailable');
    expect(withoutCli).not.toContain('Use `obsidian_history` before giving up');
  });

  it('documents new vault analysis tools with their API and CLI boundaries', () => {
    const section = buildSection({
      obsidianTools: [TOOL_OBSIDIAN_DAILY, TOOL_OBSIDIAN_GRAPH, TOOL_OBSIDIAN_TAGS, TOOL_OBSIDIAN_BASE],
    });

    expect(section).toContain('obsidian_daily');
    expect(section).toContain('Read, append, prepend, or resolve the current daily note through the Obsidian CLI');
    expect(section).toContain('`obsidian_daily` require Obsidian CLI');

    expect(section).toContain('obsidian_graph');
    expect(section).toContain('MetadataCache: orphans, deadends, and unresolved wikilinks');
    expect(section).toContain('obsidian_tags');
    expect(section).toContain('List vault tags with counts');

    expect(section).toContain('obsidian_base');
    expect(section).toContain('inspect configured views through the vault API');
    expect(section).toContain('only its query action requires Obsidian CLI');
  });

  it('uses API-only prompt variants for mixed tools when Obsidian CLI is unavailable', () => {
    const section = buildSection({
      obsidianTools: [
        TOOL_OBSIDIAN_SEARCH,
        TOOL_OBSIDIAN_LINKS,
        TOOL_OBSIDIAN_NOTE_INFO,
        TOOL_OBSIDIAN_BASE,
        TOOL_OBSIDIAN_DAILY,
      ],
      obsidianCliAvailable: false,
    });

    expect(section).toContain('Obsidian CLI is not available for this turn');
    expect(section).toContain('If the user’s request cannot be completed without a CLI-only tool/action');
    expect(section).toContain('ask the user to enable Pivi’s Obsidian CLI setting and Obsidian Settings → General → Command line interface');
    expect(section).toContain('no CLI fallback is available');
    expect(section).toContain('`format?` ignored because API-only results are JSON');
    expect(section).toContain('API-only for this turn, with no CLI fallback');
    expect(section).toContain('`action` required list|views (do not use query without CLI)');
    expect(section).toContain('`view?` and `format?` are query-only and unavailable without CLI');
    expect(section).toContain('query action is unavailable without Obsidian CLI');
    expect(section).toContain('CLI-only daily-note operations are unavailable');
    expect(section).not.toContain('only its query action requires Obsidian CLI');
  });

  it('does not describe command or eval as gated', () => {
    const section = buildSection({ obsidianTools: [TOOL_OBSIDIAN_COMMAND, TOOL_OBSIDIAN_EVAL] });

    expect(section).toContain('obsidian_command');
    expect(section).toContain('obsidian_eval');
    expect(section).not.toContain(removedGatePhrase);
  });

  it('documents Bash as a toggle-gated login-shell tool with sidebar approval for user-explicit commands', () => {
    const section = buildSection({
      obsidianTools: [TOOL_OBSIDIAN_BASH],
      bashAllowlist: ['which', 'type', 'pwd', 'git'],
    });

    expect(section).toContain('obsidian_bash');
    expect(section).toContain('pre-approved for `obsidian_bash`');
    expect(section).toContain('user login shell');
    expect(section).toContain('Bash allowlist (this turn)');
    expect(section).toContain('- `which`');
    expect(section).toContain('- `git`');
    expect(section).toContain('not pre-approved');
    expect(section).toContain('Do not run them on your own initiative');
    expect(section).toContain('user explicitly asks you to run a specific shell command');
    expect(section).toContain('sidebar prompt');
    expect(section).toContain('login shell');
    expect(section).toContain('pipes, redirects');
    expect(section).toContain('never a vault file tool');
    expect(section).toContain('do not use it to read, search, list, or modify vault files');
    expect(section).toContain('use sub-agents for multi-file vault work');
    expect(section).toContain('After the user denies a command');
    expect(section).toContain('do not call `obsidian_bash` again during the same turn');
    expect(section).toContain('when the user explicitly asks you to run a specific shell command that is not allowlisted');
    expect(section).not.toContain('do not send multi-line scripts');
  });

  it('renders unsafe Bash allowlist entries without breaking the prompt structure', () => {
    const section = buildSection({
      obsidianTools: [TOOL_OBSIDIAN_BASH],
      bashAllowlist: ['git`\n## injected instruction'],
    });

    expect(section).toContain(String.raw`- "git\`\n## injected instruction"`);
    expect(section).not.toContain('\n## injected instruction');
  });

  it('does not describe delete move or mkdir as gated', () => {
    const section = buildSection({
      obsidianTools: [TOOL_OBSIDIAN_DELETE, TOOL_OBSIDIAN_MOVE, TOOL_OBSIDIAN_MKDIR],
    });

    expect(section).toContain('obsidian_delete');
    expect(section).toContain('obsidian_move');
    expect(section).toContain('obsidian_mkdir');
    expect(section).not.toContain(removedGatePhrase);
  });

  it('documents that obsidian_search is case-insensitive', () => {
    const section = buildSection({ obsidianTools: [TOOL_OBSIDIAN_SEARCH] });

    expect(section).toContain('Case-insensitive substring search');
    expect(section).toContain('Do not repeat the same search with different casing');
  });

  it('documents the safe large Markdown read workflow', () => {
    const section = buildSection({ obsidianTools: [TOOL_OBSIDIAN_READ, TOOL_OBSIDIAN_MARKDOWN_STRUCTURE] });

    expect(section).toContain('mode: "stats"');
    expect(section).toContain('obsidian_markdown_structure');
    expect(section).toContain('startLine');
    expect(section).toContain('endLine');
  });

  it('does not instruct models to use disabled read or markdown structure tools', () => {
    const section = buildSection({ obsidianTools: [TOOL_OBSIDIAN_SEARCH] });

    expect(section).toContain('No direct note-read tool is registered');
    expect(section).not.toContain('obsidian_read');
    expect(section).not.toContain('obsidian_markdown_structure');
    expect(section).not.toContain('mode: "stats"');
  });

  it('does not recommend subagent delegation when spawn_agent is not registered', () => {
    const section = buildSection({
      obsidianTools: [TOOL_OBSIDIAN_READ, TOOL_OBSIDIAN_MARKDOWN_STRUCTURE],
      includeSubagent: false,
    });

    expect(section).not.toContain(TOOL_SPAWN_AGENT);
    expect(section).not.toContain('Automatic delegation for complex multi-context tasks');
    expect(section).not.toContain('Sub-agent delegation overrides direct reading');
  });

  it('includes subagent reading guidance only when spawn_agent is registered', () => {
    const section = buildSection({
      obsidianTools: [TOOL_OBSIDIAN_READ, TOOL_OBSIDIAN_MARKDOWN_STRUCTURE],
      includeSubagent: true,
    });

    expect(section).toContain(TOOL_SPAWN_AGENT);
    expect(section).toContain('Automatic delegation for complex multi-context tasks');
    expect(section).toContain('Sub-agent delegation overrides direct inspection');
    expect(section).toContain('When a very long file must be read end-to-end');
    expect(section).toContain('prefer `spawn_agent` with `run_in_background: true` and that single file as the delegated context batch');
    expect(section).toContain('Let the worker continue interacting with vault/tools in the background');
    expect(section).toContain('Required parameters: `label`');
    expect(section).toContain('`message` is the complete task instructions');
    expect(section).toContain('never in a `description` field');
    expect(section).toContain('Sub-agents are an active execution strategy, not a last resort');
    expect(section).toContain('asks for, allows, or says you can/may use sub-agents');
    expect(section).toContain('create 3 balanced non-overlapping batches');
    expect(section).toContain('Do not spawn only one worker and wait');
    expect(section).toContain('Automatically use multiple sub-agents');
    expect(section).toContain('Permission such as "you can/may use subagents" counts');
    expect(section).toContain('partition the exact concrete paths from `<context_files>`');
    expect(section).toContain('never delegate a glob or folder prefix');
    expect(section).toContain('concrete modified, unchanged, and failed paths');
    expect(section).toContain('ensure every path appears exactly once');
    expect(section).toContain('structural Markdown markers such as YAML `---`');
    expect(section).toContain('ask the user to clarify before mutating files');
  });

  it('omits markdown structure guidance when only obsidian_read is registered', () => {
    const section = buildSection({ obsidianTools: [TOOL_OBSIDIAN_READ] });

    expect(section).toContain('obsidian_read');
    expect(section).toContain('mode: "stats"');
    expect(section).toContain('line range');
    expect(section).toContain('clamp `maxChars` to at least 1000 characters');
    expect(section).toContain('runtime default from remaining room before the output reserve');
    expect(section).toContain('1000-character floor may cross the auto-compaction threshold');
    expect(section).toContain('instead of failing at `maxChars=0`');
    expect(section).toContain('You may override this by passing `maxChars` explicitly');
    expect(section).toContain('values below 1000 are raised to the floor');
    expect(section).toContain('largest complete-line page');
    expect(section).toContain('continue from the returned `nextStartLine`');
    expect(section).toContain('estimate how much context budget remains');
    expect(section).toContain('obsidian_markdown_structure` is not registered');
    expect(section).not.toContain('prefer `obsidian_markdown_structure`');
  });

  it('emits a Web section with WebSearch and WebFetch only when includeWebSearch is true', () => {
    const withoutSection = buildSection({ includeWebSearch: false });
    expect(withoutSection).not.toContain('### Web');
    expect(withoutSection).not.toContain('WebSearch');
    expect(withoutSection).not.toContain('WebFetch');

    const withSection = buildSection({ includeWebSearch: true });
    expect(withSection).toContain('### Web');
    expect(withSection).toContain('`WebSearch`');
    expect(withSection).toContain('Search the web for up-to-date information');
    expect(withSection).toContain('`WebFetch`');
    expect(withSection).toContain('Fetch readable content from a specific HTTP(S) URL');
    expect(withSection).toContain('Use `WebFetch` when you already have a URL');
  });

  it('documents external read tools only when they are registered', () => {
    const section = buildSection({
      obsidianTools: [TOOL_OBSIDIAN_READ_EXTERNAL, TOOL_OBSIDIAN_LIST_EXTERNAL],
    });

    expect(section).toContain(TOOL_OBSIDIAN_READ_EXTERNAL);
    expect(section).toContain('obsidian_list_external');
    expect(section).toContain('Read external files by absolute path');
    expect(section).toContain('default maxChars follows room before the output reserve');
    expect(section).toContain('use `obsidian_read_external` with an absolute path under an allowed external directory');
  });

  it('omits external read tools when they are not registered', () => {
    const section = buildSection({ obsidianTools: [] });

    expect(section).not.toContain(TOOL_OBSIDIAN_READ_EXTERNAL);
    expect(section).not.toContain('obsidian_list_external');
  });
});
