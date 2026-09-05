# Project kickoff

## Use case

Synthesize existing project notes into a kickoff brief before the first planning session, without creating or editing files.

## Copyable prompt

```text
Read the project notes, briefs, and linked meeting notes I named. Do not edit, create, or move files. Draft a kickoff brief with: stated goals, constraints, stakeholders, open questions, risks, and at most five next actions. Link every bullet to a source note. If a goal, owner, date, or risk is not in the notes, list it under Gaps instead of inferring it. Prefer quotes and existing headings over paraphrase when claims conflict. Do not invent a timeline or team roster.
```

## Safety note

Keep the first pass read-only. Hosted providers may receive the selected project notes; remove secrets, credentials, and private stakeholder details first. Missing notes are gaps, not permission to guess scope or owners.

## Expected result

A source-linked kickoff draft with goals, constraints, stakeholders, questions, risks, at most five next actions, and an explicit Gaps section.

## Review steps

1. Open each linked source and confirm the goal, constraint, or risk is actually there.
2. Move unsupported claims into Gaps instead of accepting inferred scope.
3. Reorder or cut the five next actions yourself.
4. Ask Pivi to write the approved brief only after you choose the destination note.
