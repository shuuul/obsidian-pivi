import type { HttpClient } from '../../ports';
import { DEFAULT_VAULT_SKILLS_COMMITS_URL } from './defaultVaultSkills';

interface GitHubCommitResponse {
  sha?: string;
}

/** Latest commit SHA on kepano/obsidian-skills main (null if network/API fails). */
export async function fetchDefaultVaultSkillsRemoteSha(
  httpClient: HttpClient,
): Promise<string | null> {
  try {
    const response = await httpClient.fetch({
      url: DEFAULT_VAULT_SKILLS_COMMITS_URL,
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': 'pivi-obsidian-plugin',
      },
    });
    if (!response.ok) {
      return null;
    }
    const body: GitHubCommitResponse = await response.json();
    return typeof body.sha === 'string' && body.sha.length > 0 ? body.sha : null;
  } catch {
    return null;
  }
}
