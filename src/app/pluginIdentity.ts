declare const __PIVI_RELEASE_VERSION__: string;

/** Public GitHub repository for the community plugin. */
export const PIVI_GITHUB_URL = 'https://github.com/shuuul/obsidian-pivi';

/** Issue tracker for bug reports and feature requests. */
export const PIVI_ISSUES_URL = `${PIVI_GITHUB_URL}/issues`;

/** Current plugin version injected from release metadata at build time. */
export const PIVI_VERSION = __PIVI_RELEASE_VERSION__;

/**
 * Calendar date of the currently shipped stable plugin version.
 * Keep in lockstep with the latest `CHANGELOG.md` heading when cutting a release.
 */
export const PIVI_RELEASED_AT = '2026-09-03';
