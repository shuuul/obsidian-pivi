/** Strip the legacy Obsius chat-provider prefix from stored model ids. */
export function stripObsiusModelPrefix(model: string): string {
  return model.startsWith('pi:') ? model.substring(3) : model;
}

/** Migrate a settings bag that may still use legacy `pi:` model ids. */
export function migrateObsiusModelIds(settings: Record<string, unknown>): boolean {
  let changed = false;

  if (typeof settings.model === 'string' && settings.model.startsWith('pi:')) {
    settings.model = stripObsiusModelPrefix(settings.model);
    changed = true;
  }

  if (
    typeof settings.titleGenerationModel === 'string'
    && settings.titleGenerationModel.startsWith('pi:')
  ) {
    settings.titleGenerationModel = stripObsiusModelPrefix(settings.titleGenerationModel);
    changed = true;
  }

  return changed;
}
