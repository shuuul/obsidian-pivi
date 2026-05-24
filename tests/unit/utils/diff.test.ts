import type { StructuredPatchHunk } from '../../../src/core/types/diff';
import type { ToolCallInfo } from '../../../src/core/types/tools';
import {
  countLineChanges,
  diffFromToolInput,
  extractDiffData,
  parseApplyPatchDiffs,
  structuredPatchToDiffLines,
} from '../../../src/utils/diff';

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
      expect(diffs[0]).toMatchObject({ filePath: 'new.md', operation: 'add' });
      expect(diffs[1]).toMatchObject({ filePath: 'existing.md', operation: 'update' });
      expect(diffs[0].stats.added).toBeGreaterThan(0);
    });

    it('returns empty array for blank input', () => {
      expect(parseApplyPatchDiffs('   ')).toEqual([]);
    });
  });

  describe('diffFromToolInput', () => {
    it('builds delete/insert lines for Edit tool', () => {
      const toolCall: ToolCallInfo = {
        id: '1',
        name: 'Edit',
        input: { old_string: 'a\nb', new_string: 'a\nc' },
        status: 'completed',
      };

      const diff = diffFromToolInput(toolCall, 'note.md');

      expect(diff?.filePath).toBe('note.md');
      expect(diff?.stats).toEqual({ added: 2, removed: 2 });
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
