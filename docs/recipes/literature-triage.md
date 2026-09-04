# Literature triage

## Use case

Prioritize new reading notes in `Literature/Inbox` and identify what deserves deeper processing.

## Copyable prompt

```text
Review notes in Literature/Inbox. For each note, extract its central claim, evidence type, and relevance to my current projects using links and tags already in the vault. Do not edit files. Return a table with note link, one-sentence summary, relevance (high/medium/low), reason, and one suggested next action. Flag missing source metadata instead of inventing it.
```

## Safety note

Start read-only. The model can misread sources or infer relevance incorrectly; do not treat its summary as a substitute for reading. Remove sensitive text before using a hosted model.

## Expected result

A linked triage table, missing-metadata flags, and a small high-priority reading queue.

## Review steps

1. Open each high-priority source and verify the claim and evidence.
2. Check that every link names an existing note and no citation was invented.
3. Adjust priorities, then explicitly request any property or file edits in a separate turn.
