import { requestUrl } from 'obsidian';

import { DEFAULT_VAULT_SKILLS_COMMITS_URL } from './defaultVaultSkills';

interface GitHubCommitResponse {
  sha?: string;
}

/** Latest commit SHA on kepano/obsidian-skills main (null if network/API fails). */
export async function fetchDefaultVaultSkillsRemoteSha(): Promise<string | null> {
  try {
    const response = await requestUrl({
      url: DEFAULT_VAULT_SKILLS_COMMITS_URL,
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': 'pivi-obsidian-plugin',
      },
    });
    if (response.status < 200 || response.status >= 300) {
      return null;
    }
    const body = response.json as GitHubCommitResponse;
    return typeof body.sha === 'string' && body.sha.length > 0 ? body.sha : null;
  } catch {
    return null;
  }
}
