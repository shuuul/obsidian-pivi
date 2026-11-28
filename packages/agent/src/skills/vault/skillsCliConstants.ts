/** Pinned Skills CLI package identity and staged-publish size limits. */

export const PINNED_SKILLS_CLI_PACKAGE = 'skills';
/**
 * 1.8+ migrates v1 lock hashes against the installed tree. Pivi stages local
 * edits into the CLI mirror, so that migration would clear hashes and reinstall
 * over them. Keep the last 1.7 patch until a migration-safe staging design.
 */
export const PINNED_SKILLS_CLI_VERSION = '1.7.6';

export const SKILLS_STAGE_MAX_FILES = 200;
export const SKILLS_STAGE_MAX_FILE_BYTES = 512 * 1024;
export const SKILLS_STAGE_MAX_TOTAL_BYTES = 2 * 1024 * 1024;
export const SKILLS_STAGE_MAX_SKILL_MD_BYTES = 64 * 1024;
