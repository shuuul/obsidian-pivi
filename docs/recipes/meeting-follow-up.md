# Meeting follow-up

## Use case

Turn one meeting note into a source-linked follow-up list you can verify before any vault edits.

## Copyable prompt

```text
Read the meeting note I attached or named. Do not edit files, create notes, or change task status. Extract follow-up actions that are already stated or clearly implied in that note. For each action return: proposed wording, owner if named, deadline if named, and a wiki-link back to the source meeting note plus a short quote or heading that supports it. If the owner or deadline is missing or ambiguous, write "uncertain" instead of guessing. Separate decisions from actions. Flag contradictions and items that sound like actions but have no owner, deadline, or verb.
```

## Safety note

Keep the first pass read-only. Hosted providers may receive the meeting note and any linked context you attach; strip names, private numbers, and confidential quotes first. A transcript is not a commitment: do not invent owners, dates, or tasks that the note does not support.

## Expected result

A source-linked follow-up draft: decisions, verified actions, and an uncertainty list for missing owners or deadlines.

## Review steps

1. Open the source meeting note and check every proposed action against the cited quote or heading.
2. Confirm or fill owners and deadlines yourself; leave unmarked items as uncertain.
3. Drop items that were discussion, not commitments.
4. Ask Pivi to write approved actions only after you choose the destination note.
