export interface VaultSkillsChangeNotifier {
  refreshVaultSkills(): Promise<void>;
}

/** Refresh slash skill cache and Pi system prompt on all open chat tabs. */
export async function notifyVaultSkillsChanged(notifier: VaultSkillsChangeNotifier): Promise<void> {
  await notifier.refreshVaultSkills();
}
