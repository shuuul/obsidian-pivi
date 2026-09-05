export const LONG_LINE_NORMALIZATION_DEFAULT_BODY = `Before further work on a note with oversized physical lines, split those lines at semantic boundaries with \`edit\`. Use the shortest unique local span plus \`\\n\` or \`\\n\\n\`. This inverts the default work-around-the-line strategy in Available Tools; do not copy a whole oversized line into \`oldText\`.`;

export const TRANSCRIPT_CLEANUP_DEFAULT_BODY = `Obsidian LLM-transcript notes use \`>>\` as the turn delimiter. Keep speaker turns as distinct blocks. Collapse noise (fillers, false starts, repeated acknowledgements). Keep verbatim quotes exactly. Do not invent, merge, or reattribute utterances.`;

export const WIKILINK_CONVENTIONS_DEFAULT_BODY = `When authoring wikilinks in notes, link to a note (\`[[folder/note]]\`), a heading (\`[[folder/note#Heading]]\`), or a block (\`[[folder/note#^id]]\`). Use an alias (\`[[folder/note|display]]\`) when the visible text should differ from the path. Link when a real target exists and the link is useful; do not link every mention of a word.`;

export const FRONTMATTER_CONVENTIONS_DEFAULT_BODY = `Respect existing YAML frontmatter. Add fields only when the user asks or they are clearly required. Do not reorder or drop unknown keys. Keep the opening and closing \`---\` fences intact.`;

export const DAILY_PERIODIC_NOTES_DEFAULT_BODY = `Prefer \`obsidian_daily\` for daily notes.
Do not create ad-hoc daily files that bypass the daily-notes plugin.
Periodic note naming stays user-owned; follow the vault's existing daily, weekly, and monthly conventions.`;
