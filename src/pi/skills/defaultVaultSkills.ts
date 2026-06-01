/** Default vault skills bundle installed on first seed (kepano/obsidian-skills). */
export const DEFAULT_VAULT_SKILLS_SLUG = 'kepano/obsidian-skills';

export const DEFAULT_VAULT_SKILLS_REPO_URL =
  'https://github.com/kepano/obsidian-skills';

/** GitHub REST: latest commit on default branch (kepano/obsidian-skills uses main). */
export const DEFAULT_VAULT_SKILLS_COMMITS_URL =
  'https://api.github.com/repos/kepano/obsidian-skills/commits/main';

/** Folder names under `.obsius/skills/` produced by the default bundle. */
export const DEFAULT_VAULT_SKILL_FOLDER_NAMES = [
  'obsidian-markdown',
  'obsidian-bases',
  'json-canvas',
  'obsidian-cli',
  'defuddle',
] as const;

export type DefaultVaultSkillFolderName = (typeof DEFAULT_VAULT_SKILL_FOLDER_NAMES)[number];

export function isDefaultVaultSkillFolder(
  folderName: string,
): folderName is DefaultVaultSkillFolderName {
  return (DEFAULT_VAULT_SKILL_FOLDER_NAMES as readonly string[]).includes(folderName);
}
