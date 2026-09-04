# Vault cleanup

## Use case

Find likely stale, orphaned, duplicate, or poorly linked notes before a manual cleanup session.

## Copyable prompt

```text
Audit the vault without editing, moving, or deleting anything. Identify: orphan notes, unresolved links, empty notes, likely duplicate titles, and notes with no modification in the last year that also have no incoming links. Return separate tables with note links, the evidence for each flag, and a conservative suggested action. Exclude .pivi and .obsidian folders. Do not call delete, move, write, or edit tools.
```

## Safety note

Old or unlinked does not mean useless, and duplicate titles may be intentional. Keep File Recovery enabled and back up or version the vault before any bulk change. Never approve bulk deletion from this audit alone.

## Expected result

A non-destructive inventory grouped by cleanup signal, with evidence and suggested review actions.

## Review steps

1. Sample every category and correct false positives.
2. Open candidates and inspect backlinks, embeds, aliases, and external references.
3. Resolve links or merge notes in small batches.
4. Move deletions to trash only after a final human review; rerun the audit afterward.
