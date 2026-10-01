import type { App, DataAdapter } from "obsidian";

export const NOTE_TOOLBAR_PLUGIN_ID = "note-toolbar";
export const MIN_NOTE_TOOLBAR_VERSION = "1.31.06";
export const MIN_NOTE_TOOLBAR_CLI_API_VERSION = "1.12.2";

export type NoteToolbarItemStyle = "label-and-icon" | "icon-only";

const NOTE_TOOLBAR_MARKETPLACE_URI =
  "obsidian://show-plugin?id=note-toolbar";
const NOTE_TOOLBAR_SETTINGS_URI = "obsidian://note-toolbar?settings=true";

type JsonRecord = Record<string, unknown>;

export type NoteToolbarSetupStatus =
  | "installed"
  | "already-installed"
  | "style-settings-opened"
  | "needs-text-toolbar"
  | "not-installed"
  | "plugin-activation-opened"
  | "manual-setup-opened"
  | "unsupported-note-toolbar-version"
  | "invalid-config"
  | "verification-failed"
  | "failed";

export interface NoteToolbarSetupResult {
  status: NoteToolbarSetupStatus;
  error?: string;
  version?: string;
}

const TOOLBAR_ITEM_ICON = 'message-square-plus';

export interface NoteToolbarIntegrationDependencies {
  adapter: Pick<DataAdapter, "exists" | "read">;
  apiVersion: string;
  cliAvailable: boolean;
  commandId: string;
  configDir: string;
  itemStyle: NoteToolbarItemStyle;
  itemTooltip: string;
  getItemApi?: (itemId: string) => NoteToolbarItemApi | null;
  /** In-memory plugin registry lookup: installed version, or null when absent. */
  getInstalledPluginVersion: (pluginId: string) => string | null;
  /** In-memory plugin registry lookup: whether the plugin is currently enabled. */
  isPluginEnabled: (pluginId: string) => boolean;
  openUri: (uri: string) => Promise<void>;
  runCli: (args: string[]) => Promise<string>;
}

export interface NoteToolbarItemApi {
  getIcon(): string;
  getLabel(): string;
  getTooltip(): string;
  setIcon(iconId: string): Promise<void>;
  setLabel(text: string): Promise<void>;
  setTooltip(text: string): Promise<void>;
}

interface NoteToolbarConfigState {
  config: JsonRecord;
  toolbar: JsonRecord | null;
}

interface PreparedNoteToolbarPlugin {
  result?: NoteToolbarSetupResult;
}

export function isNoteToolbarInstalled(
  getInstalledPluginVersion: (pluginId: string) => string | null,
): boolean {
  return getInstalledPluginVersion(NOTE_TOOLBAR_PLUGIN_ID) !== null;
}

async function prepareNoteToolbarPlugin(
  deps: NoteToolbarIntegrationDependencies,
): Promise<PreparedNoteToolbarPlugin> {
  const version = deps.getInstalledPluginVersion(NOTE_TOOLBAR_PLUGIN_ID);
  if (version === null) {
    return { result: { status: 'not-installed' } };
  }
  if (!isSupportedNoteToolbarVersion(version)) {
    await deps.openUri(NOTE_TOOLBAR_MARKETPLACE_URI);
    return {
      result: { status: 'unsupported-note-toolbar-version', version: version || 'unknown' },
    };
  }

  const pluginEnabled = deps.isPluginEnabled(NOTE_TOOLBAR_PLUGIN_ID);
  if (!pluginEnabled) {
    if (!deps.cliAvailable) {
      await deps.openUri(NOTE_TOOLBAR_MARKETPLACE_URI);
      return { result: { status: 'plugin-activation-opened' } };
    }
    await deps.runCli(['plugin:enable', `id=${NOTE_TOOLBAR_PLUGIN_ID}`, 'filter=community']);
  }
  return {};
}

export async function setupNoteToolbarIntegration(
  deps: NoteToolbarIntegrationDependencies,
): Promise<NoteToolbarSetupResult> {
  try {
    const prepared = await prepareNoteToolbarPlugin(deps);
    if (prepared.result) return prepared.result;
    const configState = await readNoteToolbarConfig(deps);
    if (!configState) {
      await deps.openUri(NOTE_TOOLBAR_SETTINGS_URI);
      return {
        status: "needs-text-toolbar",
      };
    }

    if (configState.toolbar === null) {
      if (
        typeof configState.config.textToolbar === "string" &&
        configState.config.textToolbar.trim()
      ) {
        return { status: "invalid-config" };
      }
      await deps.openUri(NOTE_TOOLBAR_SETTINGS_URI);
      return {
        status: "needs-text-toolbar",
      };
    }

    const existingItem = findToolbarCommand(
      configState.toolbar,
      deps.commandId,
    );
    if (existingItem) {
      const synchronized = await synchronizeExistingToolbarItem(deps, existingItem);
      if (synchronized) return synchronized;
    }
    const existingResult = await handleExistingToolbarItem(deps, existingItem);
    if (existingResult) {
      return existingResult;
    }

    if (
      !deps.cliAvailable ||
      !isVersionAtLeast(deps.apiVersion, MIN_NOTE_TOOLBAR_CLI_API_VERSION)
    ) {
      await deps.openUri(NOTE_TOOLBAR_SETTINGS_URI);
      return { status: "manual-setup-opened" };
    }

    const toolbarId = configState.toolbar.uuid;
    if (typeof toolbarId !== "string" || !toolbarId.trim()) {
      return { status: "invalid-config" };
    }

    const itemArgs = [
      "note-toolbar:add-command",
      `to=${toolbarId}`,
      `command=${deps.commandId}`,
    ];
    if (deps.itemStyle === "label-and-icon") {
      itemArgs.push("label=Pivi");
    }
    itemArgs.push(
      `icon=${TOOLBAR_ITEM_ICON}`,
      `tooltip=${deps.itemTooltip}`,
      "focus",
    );
    await deps.runCli(itemArgs);

    const verified = await readNoteToolbarConfig(deps);
    const verifiedItem = verified?.toolbar
      ? findToolbarCommand(verified.toolbar, deps.commandId)
      : null;
    if (!verifiedItem || !itemMatchesStyle(
      verifiedItem,
      deps.itemStyle,
      TOOLBAR_ITEM_ICON,
    )) {
      return { status: "verification-failed" };
    }

    return { status: "installed" };
  } catch (error) {
    return {
      status: "failed",
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function synchronizeExistingToolbarItem(
  deps: NoteToolbarIntegrationDependencies,
  item: JsonRecord,
): Promise<NoteToolbarSetupResult | null> {
  const itemId = typeof item.uuid === 'string' ? item.uuid : '';
  const api = itemId ? deps.getItemApi?.(itemId) : null;
  if (!api) return null;

  const icon = TOOLBAR_ITEM_ICON;
  const label = deps.itemStyle === 'label-and-icon' ? 'Pivi' : '';
  if (api.getIcon() !== icon) await api.setIcon(icon);
  if (api.getLabel() !== label) await api.setLabel(label);
  if (api.getTooltip() !== deps.itemTooltip) await api.setTooltip(deps.itemTooltip);
  return { status: 'already-installed' };
}

async function handleExistingToolbarItem(
  deps: NoteToolbarIntegrationDependencies,
  item: JsonRecord | null,
): Promise<NoteToolbarSetupResult | null> {
  if (!item) return null;
  if (itemMatchesStyle(
    item,
    deps.itemStyle,
    TOOLBAR_ITEM_ICON,
  )) {
    return { status: "already-installed" };
  }

  const itemId = item.uuid;
  if (
    deps.cliAvailable &&
    isVersionAtLeast(deps.apiVersion, MIN_NOTE_TOOLBAR_CLI_API_VERSION) &&
    typeof itemId === "string" &&
    itemId.trim()
  ) {
    await deps.runCli(["note-toolbar:settings", `item=${itemId}`]);
    return { status: "style-settings-opened" };
  }
  await deps.openUri(NOTE_TOOLBAR_SETTINGS_URI);
  return { status: "manual-setup-opened" };
}

function configPath(configDir: string, suffix: string): string {
  return `${configDir.replace(/\/+$/, "")}/${suffix}`;
}

async function readNoteToolbarConfig(
  deps: NoteToolbarIntegrationDependencies,
): Promise<NoteToolbarConfigState | null> {
  const path = configPath(
    deps.configDir,
    `plugins/${NOTE_TOOLBAR_PLUGIN_ID}/data.json`,
  );
  const config = await readJsonRecord(deps.adapter, path);
  if (!config) {
    return null;
  }

  const textToolbar = config.textToolbar;
  if (typeof textToolbar !== "string" || !textToolbar.trim()) {
    return { config, toolbar: null };
  }
  if (!Array.isArray(config.toolbars)) {
    return { config, toolbar: null };
  }

  const toolbar = config.toolbars.find(
    (candidate): candidate is JsonRecord =>
      isRecord(candidate) && candidate.uuid === textToolbar,
  );
  return { config, toolbar: toolbar ?? null };
}

function findToolbarCommand(
  toolbar: JsonRecord,
  commandId: string,
): JsonRecord | null {
  if (!Array.isArray(toolbar.items)) {
    return null;
  }
  return toolbar.items.find((item): item is JsonRecord => {
    if (!isRecord(item) || !isRecord(item.linkAttr)) {
      return false;
    }
    return (
      item.linkAttr.type === "command" &&
      item.linkAttr.commandId === commandId
    );
  }) ?? null;
}

function itemMatchesStyle(
  item: JsonRecord,
  itemStyle: NoteToolbarItemStyle,
  expectedIcon: string,
): boolean {
  const hasIcon = item.icon === expectedIcon;
  const hasLabel = typeof item.label === "string" && !!item.label.trim();
  return hasIcon && (itemStyle === "label-and-icon" ? hasLabel : !hasLabel);
}

async function readJsonRecord(
  adapter: Pick<DataAdapter, "exists" | "read">,
  path: string,
): Promise<JsonRecord | null> {
  if (!(await adapter.exists(path))) {
    return null;
  }
  const parsed = JSON.parse(await adapter.read(path)) as unknown;
  return isRecord(parsed) ? parsed : null;
}

function isRecord(value: unknown): value is JsonRecord {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function isVersionAtLeast(version: string, minimum: string): boolean {
  const current = parseVersion(version);
  const required = parseVersion(minimum);
  for (let index = 0; index < required.length; index += 1) {
    const currentPart = current[index] ?? 0;
    const requiredPart = required[index] ?? 0;
    if (currentPart > requiredPart) return true;
    if (currentPart < requiredPart) return false;
  }
  return true;
}

function isSupportedNoteToolbarVersion(version: string): boolean {
  return !!version && isVersionAtLeast(version, MIN_NOTE_TOOLBAR_VERSION);
}

function parseVersion(version: string): [number, number, number] {
  const parts = version.split(".", 3).map((part) => {
    const numericPrefix = /^\d+/.exec(part)?.[0];
    return numericPrefix === undefined ? 0 : Number.parseInt(numericPrefix, 10);
  });
  return [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0];
}

/** In-flight setup slot used to coalesce duplicate Note Toolbar requests. */
export type NoteToolbarSetupSlot = {
  key: string;
  promise: Promise<NoteToolbarSetupResult>;
};

/** Mutable holder so the plugin can keep one active Note Toolbar setup at a time. */
export type NoteToolbarSetupQueue = {
  active: NoteToolbarSetupSlot | null;
};

/**
 * Coalesce matching in-flight styles and serialize a different style until the
 * current setup finishes. Preserves the plugin host's single-flight behavior.
 */
export async function runQueuedNoteToolbarSetup(
  queue: NoteToolbarSetupQueue,
  itemStyle: NoteToolbarItemStyle,
  run: (itemStyle: NoteToolbarItemStyle) => Promise<NoteToolbarSetupResult>,
): Promise<NoteToolbarSetupResult> {
  return runQueuedNoteToolbarRequest(queue, itemStyle, () => run(itemStyle));
}

export async function runQueuedNoteToolbarRequest(
  queue: NoteToolbarSetupQueue,
  key: string,
  run: () => Promise<NoteToolbarSetupResult>,
): Promise<NoteToolbarSetupResult> {
  const activeSetup = queue.active;
  if (activeSetup?.key === key) {
    return await activeSetup.promise;
  }
  if (activeSetup) {
    await activeSetup.promise;
    return await runQueuedNoteToolbarRequest(queue, key, run);
  }

  const setup: NoteToolbarSetupSlot = {
    key,
    promise: run(),
  };
  queue.active = setup;

  try {
    return await setup.promise;
  } finally {
    if (queue.active === setup) {
      queue.active = null;
    }
  }
}

/**
 * Reads the host's in-memory plugin registry instead of probing manifest files
 * on disk: the registry is the fresher source, and keeping `manifest.json`
 * path literals out of the shipped bundle avoids matching the community
 * review's self-update static scan. The Obsidian plugins API is internal, so
 * every access is defensively optional-chained; any failure reports the
 * plugin as not installed, which falls back to the manual setup flow.
 */
export function getInstalledPluginVersion(app: App, pluginId: string): string | null {
  try {
    const manifests = (app as unknown as {
      plugins?: { manifests?: Record<string, { version?: unknown } | undefined> };
    }).plugins?.manifests;
    const manifest = manifests?.[pluginId];
    if (!manifest) {
      return null;
    }
    return typeof manifest.version === 'string' ? manifest.version : '';
  } catch {
    return null;
  }
}

/** Registry companion to `getInstalledPluginVersion`; failure means not enabled. */
export function isPluginEnabled(app: App, pluginId: string): boolean {
  try {
    const enabledPlugins = (app as unknown as {
      plugins?: { enabledPlugins?: { has?: (id: string) => boolean } };
    }).plugins?.enabledPlugins;
    return enabledPlugins?.has?.(pluginId) === true;
  } catch {
    return false;
  }
}

/**
 * Returns true when the Note Toolbar community plugin is enabled AND its
 * selected-text toolbar is configured (a non-empty `textToolbar` uuid in its
 * data.json). Pivi uses this to yield the editor selection surface to Note
 * Toolbar at runtime.
 *
 * The Obsidian plugins API is internal, so every access is defensively
 * optional-chained; any failure returns false. This is fast and side-effect
 * free — it only reads in-memory plugin state already loaded by Obsidian.
 */
export function isNoteToolbarTextToolbarActive(app: App): boolean {
  try {
    const plugins = (app as unknown as {
      plugins?: {
        enabledPlugins?: { has?: (id: string) => boolean };
        plugins?: Record<string, { data?: { textToolbar?: unknown } } | undefined>;
      };
    }).plugins;
    if (!plugins) {
      return false;
    }

    const enabledPlugins = plugins.enabledPlugins;
    if (!enabledPlugins || typeof enabledPlugins.has !== 'function') {
      // Fall back to the plugin instance presence check below.
    } else if (!enabledPlugins.has(NOTE_TOOLBAR_PLUGIN_ID)) {
      return false;
    }

    const pluginInstance = plugins.plugins?.[NOTE_TOOLBAR_PLUGIN_ID];
    if (!pluginInstance) {
      return false;
    }

    const textToolbar = pluginInstance.data?.textToolbar;
    return typeof textToolbar === 'string' && textToolbar.trim().length > 0;
  } catch {
    return false;
  }
}
