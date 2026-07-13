export interface AppSkillSummary {
  name: string;
  description?: string;
}

export interface AppSkillProvider {
  listSkills(): AppSkillSummary[];
}
