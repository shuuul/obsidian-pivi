import type { StructuredPatchHunk } from '@pivi/pivi-agent-core/foundation/diff';
import type { ToolCallInfo } from '@pivi/pivi-agent-core/foundation/tools';
import { TOOL_OBSIDIAN_EDIT } from '@pivi/pivi-agent-core/tools/obsidianToolNames';
import {
  buildSubstringPatchHunks,
  countLineChanges,
  diffFromToolInput,
  extractDiffData,
  parseApplyPatchDiffs,
  structuredPatchToDiffLines,
} from '@pivi/pivi-agent-core/tools/diff';

describe('diff utils', () => {
  describe('structuredPatchToDiffLines', () => {
    it('maps unified diff hunks to DiffLine entries', () => {
      const hunks: StructuredPatchHunk[] = [{
        oldStart: 1,
        oldLines: 1,
        newStart: 1,
        newLines: 2,
        lines: ['-old', '+new', ' same'],
      }];

      const lines = structuredPatchToDiffLines(hunks);

      expect(lines).toEqual([
        { type: 'delete', text: 'old', oldLineNum: 1 },
        { type: 'insert', text: 'new', newLineNum: 1 },
        { type: 'equal', text: 'same', oldLineNum: 2, newLineNum: 2 },
      ]);
    });
  });

  describe('countLineChanges', () => {
    it('counts insert and delete lines', () => {
      const stats = countLineChanges([
        { type: 'insert', text: 'a', newLineNum: 1 },
        { type: 'delete', text: 'b', oldLineNum: 1 },
        { type: 'equal', text: 'c', oldLineNum: 2, newLineNum: 2 },
      ]);

      expect(stats).toEqual({ added: 1, removed: 1 });
    });
  });

  describe('parseApplyPatchDiffs', () => {
    it('parses add and update file sections', () => {
      const patch = `*** Begin Patch
*** Add File: new.md
+line one
*** Update File: existing.md
-old
+new
*** End Patch`;

      const diffs = parseApplyPatchDiffs(patch);

      expect(diffs).toHaveLength(2);
      const [addedDiff, updatedDiff] = diffs;
      expect(addedDiff).toBeDefined();
      expect(updatedDiff).toBeDefined();
      if (!addedDiff || !updatedDiff) throw new Error('Expected add and update diffs');
      expect(addedDiff).toMatchObject({ filePath: 'new.md', operation: 'add' });
      expect(updatedDiff).toMatchObject({ filePath: 'existing.md', operation: 'update' });
      expect(addedDiff.stats.added).toBeGreaterThan(0);
    });

    it('returns empty array for blank input', () => {
      expect(parseApplyPatchDiffs('   ')).toEqual([]);
    });
  });

  describe('buildSubstringPatchHunks', () => {
    it('builds a hunk with delete and insert lines', () => {
      const hunks = buildSubstringPatchHunks('a\nb', 'c');
      const [hunk] = hunks;
      expect(hunk).toBeDefined();
      if (!hunk) throw new Error('Expected a diff hunk');
      expect(hunk.lines).toEqual(['-a', '-b', '+c']);
    });

    it('preserves unchanged lines as context in a line-level diff', () => {
      const hunks = buildSubstringPatchHunks('same\nold', 'same\nnew');

      expect(hunks).toEqual([{
        oldStart: 1,
        oldLines: 2,
        newStart: 1,
        newLines: 2,
        lines: [' same', '-old', '+new'],
      }]);
    });

    it('counts a trailing newline as an empty split line in the hunk', () => {
      const hunks = buildSubstringPatchHunks('old\n', 'new\n');

      const [hunk] = hunks;
      expect(hunk).toBeDefined();
      if (!hunk) throw new Error('Expected a diff hunk');
      expect(hunk).toMatchObject({ oldLines: 2, newLines: 2 });
      expect(hunk.lines).toEqual(['-old', '+new', ' ']);
    });
  });

  describe('diffFromToolInput', () => {
    it('builds diff for obsidian_edit from path and strings', () => {
      const toolCall: ToolCallInfo = {
        id: '2',
        name: TOOL_OBSIDIAN_EDIT,
        input: { path: 'note.md', old_string: 'old', new_string: 'new' },
        status: 'completed',
      };

      const diff = diffFromToolInput(toolCall, 'file');

      expect(diff?.filePath).toBe('note.md');
      expect(diff?.stats).toEqual({ added: 1, removed: 1 });
    });

    it('builds delete/insert lines for Edit tool', () => {
      const toolCall: ToolCallInfo = {
        id: '1',
        name: 'Edit',
        input: { old_string: 'a\nb', new_string: 'a\nc' },
        status: 'completed',
      };

      const diff = diffFromToolInput(toolCall, 'note.md');

      expect(diff?.filePath).toBe('note.md');
      expect(diff?.stats).toEqual({ added: 1, removed: 1 });
    });

    it('builds line-level old/new string diffs with unchanged context lines', () => {
      const toolCall: ToolCallInfo = {
        id: 'coarse-edit',
        name: 'Edit',
        input: { old_string: 'same\nold', new_string: 'same\nnew' },
        status: 'completed',
      };

      const diff = diffFromToolInput(toolCall, 'note.md');

      expect(diff).toEqual({
        filePath: 'note.md',
        stats: { added: 1, removed: 1 },
        diffLines: [
          { type: 'equal', text: 'same', oldLineNum: 1, newLineNum: 1 },
          { type: 'delete', text: 'old', oldLineNum: 2 },
          { type: 'insert', text: 'new', newLineNum: 2 },
        ],
      });
    });

    it('uses obsidian_edit file fallback when path is blank and file is provided', () => {
      const toolCall: ToolCallInfo = {
        id: 'obsidian-file-fallback',
        name: TOOL_OBSIDIAN_EDIT,
        input: { path: '  ', file: 'folder/note.md', old_string: 'old', new_string: 'new' },
        status: 'completed',
      };

      const diff = diffFromToolInput(toolCall, 'fallback.md');

      expect(diff?.filePath).toBe('folder/note.md');
      expect(diff?.stats).toEqual({ added: 1, removed: 1 });
    });

    it('returns undefined for edit-like calls without both old and new strings', () => {
      const toolCall: ToolCallInfo = {
        id: 'missing-new',
        name: 'Edit',
        input: { old_string: 'old' },
        status: 'completed',
      };

      expect(diffFromToolInput(toolCall, 'note.md')).toBeUndefined();
    });

    it('builds insert-only diff for Write tool', () => {
      const toolCall: ToolCallInfo = {
        id: '2',
        name: 'Write',
        input: { content: 'hello\nworld' },
        status: 'completed',
      };

      const diff = diffFromToolInput(toolCall, 'out.md');

      expect(diff?.diffLines.every((l) => l.type === 'insert')).toBe(true);
      expect(diff?.stats.added).toBe(2);
    });
  });

  describe('extractDiffData', () => {
    it('prefers structuredPatch from tool result', () => {
      const toolCall: ToolCallInfo = {
        id: '3',
        name: 'Edit',
        input: { file_path: 'x.md', old_string: 'a', new_string: 'b' },
        status: 'completed',
      };
      const result = {
        filePath: 'from-result.md',
        structuredPatch: [{
          oldStart: 1,
          newStart: 1,
          lines: ['-a', '+b'],
        }],
      };

      const diff = extractDiffData(result, toolCall);

      expect(diff?.filePath).toBe('from-result.md');
      expect(diff?.stats).toEqual({ added: 1, removed: 1 });
    });
  });
});
