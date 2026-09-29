/** Descriptor of the featured skill bundle offered for one-click install. */
export interface SettingsFeaturedSkillBundle {
  getDescriptor(): {
    readonly name: string;
    readonly description: string;
    readonly source: string;
    readonly sourceUrl: string;
  };
  isInstalled(): boolean;
  install(): Promise<void>;
  update(): Promise<void>;
}

export interface SettingsSkillsPort {
  featuredBundle: SettingsFeaturedSkillBundle;
  list(): readonly { name: string; description: string; folderName: string; disabled: boolean }[];
  listRemote(source: string): Promise<readonly { name: string; description: string }[]>;
  install(source: string, skillNames?: readonly string[]): Promise<void>;
  setDisabled(folderName: string, disabled: boolean): Promise<void>;
  remove(folderName: string): Promise<void>;
  updateAll(): Promise<void>;
  update(skillName: string, folderName: string): Promise<void>;
}
