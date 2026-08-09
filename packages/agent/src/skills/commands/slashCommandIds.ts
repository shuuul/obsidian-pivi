/** Built-in slash command ids shared by catalog and product UI. */
export const GENERATE_IMAGE_TOOL_ID = 'generate-image';
export const COMPACT_COMMAND_ID = 'compact';
export const NEW_SESSION_COMMAND_ID = 'new';

/** Ids owned by Pivi runtime behavior and unavailable to workspace commands. */
export const RESERVED_COMMAND_IDS: ReadonlySet<string> = new Set([
  NEW_SESSION_COMMAND_ID,
  COMPACT_COMMAND_ID,
  GENERATE_IMAGE_TOOL_ID,
]);

export function isReservedCommandId(id: string): boolean {
  return RESERVED_COMMAND_IDS.has(id.toLowerCase());
}
