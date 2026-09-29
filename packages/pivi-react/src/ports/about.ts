export interface SettingsAboutSnapshot {
  readonly version: string;
  readonly releasedAt: string;
  readonly githubUrl: string;
  readonly issuesUrl: string;
}

export interface SettingsAboutPort {
  getSnapshot(): SettingsAboutSnapshot;
}
