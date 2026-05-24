/** Vault-local Obsius data root (settings, sessions index via JSONL under sessions/). */
export const OBSIUS_STORAGE_PATH = '.obsius';

export const OBSIUS_SETTINGS_PATH = `${OBSIUS_STORAGE_PATH}/settings.json`;

/** Previous vault layout — read fallback only; do not write. */
export const LEGACY_OBSIUS_STORAGE_PATH = '.obsius2';

export const LEGACY_OBSIUS_SETTINGS_PATH = `${LEGACY_OBSIUS_STORAGE_PATH}/obsius2-settings.json`;

export const LEGACY_SESSIONS_PATH = `${LEGACY_OBSIUS_STORAGE_PATH}/sessions`;
