import { Notice, setIcon } from 'obsidian';
import * as os from 'os';
import * as path from 'path';

import type {
  AppMcpOAuth,
  AppMcpServerProbeProvider,
  AppModelReadinessProvider,
  ChatModeSelectorConfig,
  ChatPermissionModeToggleConfig,
  ChatReasoningOption,
  ChatUIConfig,
  ChatUIOption,
  RuntimeCapabilities,
} from '../../../core/agent/types';
import type { McpServerManager } from '../../../core/mcp/McpServerManager';
import type {
  ManagedMcpServer,
  UsageInfo,
} from '../../../core/types';
import { supportsMcpOAuth } from '../../../core/types';
import { appendCheckIcon, appendMcpIcon } from '../../../shared/icons';
import { appendModelOptionIcon } from '../../../shared/providerLogo';
import { filterValidPaths, findConflictingPath, isDuplicatePath, isValidDirectoryPath, validateDirectoryPath } from '../../../utils/externalContext';
import { expandHomePath, normalizePathForFilesystem } from '../../../utils/path';

interface ElectronOpenDialogResult {
  canceled: boolean;
  filePaths: string[];
}

interface ElectronRemoteApi {
  dialog: {
    showOpenDialog(options: { properties: string[]; title: string }): Promise<ElectronOpenDialogResult>;
  };
}

function runToolbarAction(action: () => Promise<void>, failureMessage: string): void {
  void action().catch(() => {
    new Notice(failureMessage);
  });
}

export interface ToolbarSettings {
  model: string;
  thinkingBudget: string;
  thinkingLevel: string;
  permissionMode: string;
  [key: string]: unknown;
}

export interface ToolbarCallbacks {
  onModelChange: (model: string) => Promise<void>;
  onModeChange: (mode: string) => Promise<void>;
  onThinkingBudgetChange: (budget: string) => Promise<void>;
  onThinkingLevelChange: (thinkingLevel: string) => Promise<void>;
  onPermissionModeChange: (mode: string) => Promise<void>;
  getSettings: () => ToolbarSettings;
  getEnvironmentVariables?: () => string;
  getUIConfig: () => ChatUIConfig;
  getCapabilities: () => RuntimeCapabilities;
  getModelReadinessProvider?: () => AppModelReadinessProvider | null;
}

export class ModelSelector {
  private container: HTMLElement;
  private buttonEl: HTMLElement | null = null;
  private dropdownEl: HTMLElement | null = null;
  private callbacks: ToolbarCallbacks;
  constructor(parentEl: HTMLElement, callbacks: ToolbarCallbacks) {
    this.callbacks = callbacks;
    this.container = parentEl.createDiv({ cls: 'pivi-model-selector' });
    this.render();
  }

  private getAvailableModels() {
    const settings = this.callbacks.getSettings();
    const uiConfig = this.callbacks.getUIConfig();
    return uiConfig.getModelOptions({
      ...settings,
      environmentVariables: this.callbacks.getEnvironmentVariables?.(),
    });
  }

  private render() {
    this.container.empty();

    this.buttonEl = this.container.createDiv({ cls: 'pivi-model-btn' });
    this.updateDisplay();

    this.dropdownEl = this.container.createDiv({ cls: 'pivi-model-dropdown' });
    this.renderOptions();
  }

  updateDisplay() {
    if (!this.buttonEl) return;
    const currentModel = this.callbacks.getSettings().model;
    const models = this.getAvailableModels();
    const modelInfo = models.find(m => m.value === currentModel);

    const displayModel = modelInfo || models[0];
    const uiConfig = this.callbacks.getUIConfig();

    this.buttonEl.empty();

    if (displayModel) {
      appendModelOptionIcon(this.buttonEl, displayModel, {
        fallbackChatIcon: uiConfig.getChatIcon?.() ?? undefined,
        size: 12,
      });
    }

    const labelEl = this.buttonEl.createSpan({ cls: 'pivi-model-label' });
    labelEl.setText(displayModel?.label || 'Unknown');
  }

  renderOptions() {
    if (!this.dropdownEl) return;
    this.dropdownEl.empty();

    const currentModel = this.callbacks.getSettings().model;
    const models = this.getAvailableModels();
    const uiConfig = this.callbacks.getUIConfig();
    const fallbackChatIcon = uiConfig.getChatIcon?.() ?? undefined;

    const reversed = [...models].reverse();

    let lastGroup: string | undefined;
    for (const model of reversed) {
      if (model.group && model.group !== lastGroup) {
        const separator = this.dropdownEl.createDiv({ cls: 'pivi-model-group' });
        separator.setText(model.group);
        lastGroup = model.group;
      }

      const option = this.dropdownEl.createDiv({ cls: 'pivi-model-option' });
      if (model.value === currentModel) {
        option.addClass('selected');
      }

      appendModelOptionIcon(option, model, {
        fallbackChatIcon,
        size: 12,
      });
      option.createSpan({ cls: 'pivi-model-option-label', text: model.label });

      if (model.description) {
        option.setAttribute('title', model.description);
      }

      option.addEventListener('click', (e) => {
        e.stopPropagation();
        runToolbarAction(async () => {
          await this.callbacks.onModelChange(model.value);
          this.updateDisplay();
          this.renderOptions();
        }, 'Failed to change model');
      });
    }
  }
}

export class ModeSelector {
  private container: HTMLElement;
  private labelEl: HTMLElement | null = null;
  private toggleEl: HTMLElement | null = null;
  private callbacks: ToolbarCallbacks;

  constructor(parentEl: HTMLElement, callbacks: ToolbarCallbacks) {
    this.callbacks = callbacks;
    this.container = parentEl.createDiv({ cls: 'pivi-mode-selector' });
    this.render();
  }

  private getSelectorConfig(): ChatModeSelectorConfig | null {
    return this.callbacks.getUIConfig().getModeSelector?.(this.callbacks.getSettings()) ?? null;
  }

  private render() {
    this.container.empty();

    this.labelEl = this.container.createSpan({ cls: 'pivi-mode-label' });
    this.toggleEl = this.container.createDiv({ cls: 'pivi-toggle-switch' });

    this.toggleEl.addEventListener('click', () => {
      runToolbarAction(() => this.toggle(), 'Failed to change mode');
    });

    this.updateDisplay();
  }

  /** Resolves the active/inactive option pair for a two-option toggle. */
  private resolveOptionPair(
    selectorConfig: ChatModeSelectorConfig,
  ): { active: ChatUIOption; inactive: ChatUIOption } {
    const [first, second] = selectorConfig.options;
    const active = selectorConfig.activeValue
      ? selectorConfig.options.find((option) => option.value === selectorConfig.activeValue) ?? second
      : second;
    const inactive = active.value === first.value ? second : first;
    return { active, inactive };
  }

  updateDisplay() {
    if (!this.toggleEl || !this.labelEl) {
      return;
    }

    const selectorConfig = this.getSelectorConfig();
    if (!selectorConfig || selectorConfig.options.length !== 2) {
      this.container.addClass('pivi-hidden');
      return;
    }

    this.container.removeClass('pivi-hidden');
    const { active, inactive } = this.resolveOptionPair(selectorConfig);
    const currentOption = selectorConfig.options.find((option) => option.value === selectorConfig.value)
      ?? selectorConfig.options[0];
    const isActive = currentOption.value === active.value;

    this.labelEl.setText(currentOption.label || selectorConfig.label);
    this.labelEl.toggleClass('active', isActive);
    if (isActive) {
      this.toggleEl.addClass('active');
    } else {
      this.toggleEl.removeClass('active');
    }

    const titleParts = [`${inactive.label} <-> ${active.label}`];
    if (currentOption.description) {
      titleParts.push(currentOption.description);
    }
    this.container.setAttribute('title', titleParts.join('\n'));
  }

  renderOptions() {
    this.updateDisplay();
  }

  private async toggle() {
    const selectorConfig = this.getSelectorConfig();
    if (!selectorConfig || selectorConfig.options.length !== 2) {
      return;
    }

    const { active, inactive } = this.resolveOptionPair(selectorConfig);
    const nextValue = selectorConfig.value === active.value ? inactive.value : active.value;
    await this.callbacks.onModeChange(nextValue);
    this.updateDisplay();
  }
}

export class ThinkingBudgetSelector {
  private container: HTMLElement;
  private effortEl: HTMLElement | null = null;
  private effortGearsEl: HTMLElement | null = null;
  private budgetEl: HTMLElement | null = null;
  private budgetGearsEl: HTMLElement | null = null;
  private callbacks: ToolbarCallbacks;

  constructor(parentEl: HTMLElement, callbacks: ToolbarCallbacks) {
    this.callbacks = callbacks;
    this.container = parentEl.createDiv({ cls: 'pivi-thinking-selector' });
    this.render();
  }

  private render() {
    this.container.empty();

    // Effort selector (for adaptive thinking models)
    this.effortEl = this.container.createDiv({ cls: 'pivi-thinking-effort' });
    const effortLabel = this.effortEl.createSpan({ cls: 'pivi-thinking-label-text' });
    effortLabel.setText('Think:');
    this.effortGearsEl = this.effortEl.createDiv({ cls: 'pivi-thinking-gears' });

    // Legacy budget selector (for custom models)
    this.budgetEl = this.container.createDiv({ cls: 'pivi-thinking-budget' });
    const budgetLabel = this.budgetEl.createSpan({ cls: 'pivi-thinking-label-text' });
    budgetLabel.setText('Thinking:');
    this.budgetGearsEl = this.budgetEl.createDiv({ cls: 'pivi-thinking-gears' });

    this.updateDisplay();
  }

  private renderEffortGears() {
    if (!this.effortGearsEl) return;
    this.effortGearsEl.empty();

    const currentThinkingLevel = this.callbacks.getSettings().thinkingLevel;
    const uiConfig = this.callbacks.getUIConfig();
    const settings = this.callbacks.getSettings();
    const model = settings.model;
    const options = uiConfig.getReasoningOptions(model, settings);
    const currentInfo = options.find(e => e.value === currentThinkingLevel);

    const currentEl = this.effortGearsEl.createDiv({ cls: 'pivi-thinking-current' });
    currentEl.setText(currentInfo?.label || options[0]?.label || 'High');

    const optionsEl = this.effortGearsEl.createDiv({ cls: 'pivi-thinking-options' });

    for (const level of [...options].reverse()) {
      const gearEl = optionsEl.createDiv({ cls: 'pivi-thinking-gear' });
      gearEl.setText(level.label);

      if (level.value === currentThinkingLevel) {
        gearEl.addClass('selected');
      }

      gearEl.addEventListener('click', (e) => {
        e.stopPropagation();
        runToolbarAction(async () => {
          await this.callbacks.onThinkingLevelChange(level.value);
          this.updateDisplay();
        }, 'Failed to change thinking level');
      });
    }
  }

  private renderBudgetGears() {
    if (!this.budgetGearsEl) return;
    this.budgetGearsEl.empty();

    const currentBudget = this.callbacks.getSettings().thinkingBudget;
    const uiConfig = this.callbacks.getUIConfig();
    const settings = this.callbacks.getSettings();
    const model = settings.model;
    const options: ChatReasoningOption[] = uiConfig.getReasoningOptions(model, settings);
    const currentBudgetInfo = options.find(b => b.value === currentBudget);

    const currentEl = this.budgetGearsEl.createDiv({ cls: 'pivi-thinking-current' });
    currentEl.setText(currentBudgetInfo?.label || options[0]?.label || 'Off');

    const optionsEl = this.budgetGearsEl.createDiv({ cls: 'pivi-thinking-options' });

    for (const budget of [...options].reverse()) {
      const gearEl = optionsEl.createDiv({ cls: 'pivi-thinking-gear' });
      gearEl.setText(budget.label);
      const tokens = budget.tokens ?? 0;
      gearEl.setAttribute('title', tokens > 0 ? `${tokens.toLocaleString()} tokens` : 'Disabled');

      if (budget.value === currentBudget) {
        gearEl.addClass('selected');
      }

      gearEl.addEventListener('click', (e) => {
        e.stopPropagation();
        runToolbarAction(async () => {
          await this.callbacks.onThinkingBudgetChange(budget.value);
          this.updateDisplay();
        }, 'Failed to change thinking budget');
      });
    }
  }

  updateDisplay() {
    const capabilities = this.callbacks.getCapabilities();
    if (capabilities.reasoningControl === 'none') {
      this.effortEl?.addClass('pivi-hidden');
      this.budgetEl?.addClass('pivi-hidden');
      return;
    }

    const settings = this.callbacks.getSettings();
    const model = settings.model;
    const uiConfig = this.callbacks.getUIConfig();
    const options = uiConfig.getReasoningOptions(model, settings);
    const defaultValue = uiConfig.getDefaultReasoningValue(model, settings);
    const shouldHide = options.length === 0
      || (options.length === 1 && options[0]?.value === defaultValue);

    if (shouldHide) {
      this.effortEl?.addClass('pivi-hidden');
      this.budgetEl?.addClass('pivi-hidden');
      return;
    }

    const adaptive = uiConfig.isAdaptiveReasoningModel(model, settings);

    if (this.effortEl) {
      this.effortEl.toggleClass('pivi-hidden', !adaptive);
    }
    if (this.budgetEl) {
      this.budgetEl.toggleClass('pivi-hidden', adaptive);
    }

    if (adaptive) {
      this.renderEffortGears();
    } else {
      this.renderBudgetGears();
    }
  }
}

export class PermissionToggle {
  private container: HTMLElement;
  private toggleEl: HTMLElement | null = null;
  private labelEl: HTMLElement | null = null;
  private callbacks: ToolbarCallbacks;
  private visible = true;

  constructor(parentEl: HTMLElement, callbacks: ToolbarCallbacks) {
    this.callbacks = callbacks;
    this.container = parentEl.createDiv({ cls: 'pivi-permission-toggle' });
    this.render();
  }

  setVisible(visible: boolean): void {
    this.visible = visible;
    this.updateDisplay();
  }

  private render() {
    this.container.empty();

    this.labelEl = this.container.createSpan({ cls: 'pivi-permission-label' });
    this.toggleEl = this.container.createDiv({ cls: 'pivi-toggle-switch' });

    this.updateDisplay();

    this.toggleEl.addEventListener('click', () => {
      runToolbarAction(() => this.toggle(), 'Failed to change permission mode');
    });
  }

  private getToggleConfig(): ChatPermissionModeToggleConfig | null {
    const uiConfig = this.callbacks.getUIConfig();
    return uiConfig.getPermissionModeToggle?.() ?? null;
  }

  updateDisplay() {
    if (!this.toggleEl || !this.labelEl) return;

    const toggleConfig = this.getToggleConfig();
    const capabilities = this.callbacks.getCapabilities();
    if (!this.visible || !toggleConfig) {
      this.container.addClass('pivi-hidden');
      return;
    }

    this.container.removeClass('pivi-hidden');
    const mode = this.callbacks.getSettings().permissionMode;
    const planValue = toggleConfig.planValue;
    const planLabel = toggleConfig.planLabel ?? 'PLAN';
    const canShowPlan = Boolean(planValue) && capabilities.supportsPlanMode;

    if (canShowPlan && planValue && mode === planValue) {
      this.toggleEl.addClass('pivi-hidden');
      this.labelEl.setText(planLabel);
      this.labelEl.addClass('plan-active');
    } else {
      this.toggleEl.removeClass('pivi-hidden');
      this.labelEl.removeClass('plan-active');
      if (mode === toggleConfig.activeValue) {
        this.toggleEl.addClass('active');
        this.labelEl.setText(toggleConfig.activeLabel);
      } else {
        this.toggleEl.removeClass('active');
        this.labelEl.setText(toggleConfig.inactiveLabel);
      }
    }
  }

  private async toggle() {
    const toggleConfig = this.getToggleConfig();
    if (!toggleConfig) return;

    const current = this.callbacks.getSettings().permissionMode;
    const newMode = current === toggleConfig.activeValue
      ? toggleConfig.inactiveValue
      : toggleConfig.activeValue;
    await this.callbacks.onPermissionModeChange(newMode);
    this.updateDisplay();
  }
}

export type AddExternalContextResult =
  | { success: true; normalizedPath: string }
  | { success: false; error: string };

export class ExternalContextSelector {
  private container: HTMLElement;
  private iconEl: HTMLElement | null = null;
  private badgeEl: HTMLElement | null = null;
  private dropdownEl: HTMLElement | null = null;
  private callbacks: ToolbarCallbacks;
  /**
   * Current external context paths. May contain:
   * - Persistent paths only (new sessions via clearExternalContexts)
   * - Restored session paths (loaded sessions via setExternalContexts)
   * - Mixed paths during active sessions
   */
  private externalContextPaths: string[] = [];
  /** Paths that persist across all sessions (stored in settings). */
  private persistentPaths: Set<string> = new Set();
  private onChangeCallback: ((paths: string[]) => void) | null = null;
  private onPersistenceChangeCallback: ((paths: string[]) => void) | null = null;

  constructor(parentEl: HTMLElement, callbacks: ToolbarCallbacks) {
    this.callbacks = callbacks;
    this.container = parentEl.createDiv({ cls: 'pivi-external-context-selector' });
    this.render();
  }

  setOnChange(callback: (paths: string[]) => void): void {
    this.onChangeCallback = callback;
  }

  setOnPersistenceChange(callback: (paths: string[]) => void): void {
    this.onPersistenceChangeCallback = callback;
  }

  getExternalContexts(): string[] {
    return [...this.externalContextPaths];
  }

  getPersistentPaths(): string[] {
    return [...this.persistentPaths];
  }

  setPersistentPaths(paths: string[]): void {
    // Validate paths - remove non-existent directories
    const validPaths = filterValidPaths(paths);
    const invalidPaths = paths.filter(p => !validPaths.includes(p));

    this.persistentPaths = new Set(validPaths);
    // Merge persistent paths into external context paths
    this.mergePersistentPaths();
    this.updateDisplay();
    this.renderDropdown();

    // If invalid paths were removed, notify user and save updated list
    if (invalidPaths.length > 0) {
      const pathNames = invalidPaths.map(p => this.shortenPath(p)).join(', ');
      new Notice(`Removed ${invalidPaths.length} invalid external context path(s): ${pathNames}`, 5000);
      this.onPersistenceChangeCallback?.([...this.persistentPaths]);
    }
  }

  togglePersistence(path: string): void {
    if (this.persistentPaths.has(path)) {
      this.persistentPaths.delete(path);
    } else {
      // Validate path still exists before persisting
      if (!isValidDirectoryPath(path)) {
        new Notice(`Cannot persist "${this.shortenPath(path)}" - directory no longer exists`, 4000);
        return;
      }
      this.persistentPaths.add(path);
    }
    this.onPersistenceChangeCallback?.([...this.persistentPaths]);
    this.renderDropdown();
  }

  private mergePersistentPaths(): void {
    const pathSet = new Set(this.externalContextPaths);
    for (const path of this.persistentPaths) {
      pathSet.add(path);
    }
    this.externalContextPaths = [...pathSet];
  }

  /**
   * Restore exact external context paths from a saved session.
   * Does NOT merge with persistent paths - preserves the session's historical state.
   * Use clearExternalContexts() for new sessions to start with current persistent paths.
   */
  setExternalContexts(paths: string[]): void {
    this.externalContextPaths = [...paths];
    this.updateDisplay();
    this.renderDropdown();
  }

  /**
   * Remove a path from external contexts (and persistent paths if applicable).
   * Exposed for testing the remove button behavior.
   */
  removePath(pathStr: string): void {
    this.externalContextPaths = this.externalContextPaths.filter(p => p !== pathStr);
    // Also remove from persistent paths if it was persistent
    if (this.persistentPaths.has(pathStr)) {
      this.persistentPaths.delete(pathStr);
      this.onPersistenceChangeCallback?.([...this.persistentPaths]);
    }
    this.onChangeCallback?.(this.externalContextPaths);
    this.updateDisplay();
    this.renderDropdown();
  }

  /**
   * Add an external context path programmatically.
   * Validates the path and handles duplicates/conflicts.
   * @param pathInput - Path string (supports ~/ expansion)
   * @returns Result with success status and normalized path, or error message on failure
   */
  addExternalContext(pathInput: string): AddExternalContextResult {
    const trimmed = pathInput?.trim();
    if (!trimmed) {
      return { success: false, error: 'No path provided.' };
    }

    // Strip surrounding quotes if present (e.g., "/path/with spaces")
    let cleanPath = trimmed;
    if ((cleanPath.startsWith('"') && cleanPath.endsWith('"')) ||
        (cleanPath.startsWith("'") && cleanPath.endsWith("'"))) {
      cleanPath = cleanPath.slice(1, -1);
    }

    // Expand home directory and normalize path
    const expandedPath = expandHomePath(cleanPath);
    const normalizedPath = normalizePathForFilesystem(expandedPath);

    if (!path.isAbsolute(normalizedPath)) {
      return { success: false, error: 'Path must be absolute.' };
    }

    // Validate path exists and is a directory with specific error messages
    const validation = validateDirectoryPath(normalizedPath);
    if (!validation.valid) {
      return { success: false, error: `${validation.error}: ${pathInput}` };
    }

    // Check for duplicate (normalized comparison for cross-platform support)
    if (isDuplicatePath(normalizedPath, this.externalContextPaths)) {
      return { success: false, error: 'This folder is already added as an external context.' };
    }

    // Check for nested/overlapping paths
    const conflict = findConflictingPath(normalizedPath, this.externalContextPaths);
    if (conflict) {
      return { success: false, error: this.formatConflictMessage(normalizedPath, conflict) };
    }

    // Add the path
    this.externalContextPaths = [...this.externalContextPaths, normalizedPath];
    this.onChangeCallback?.(this.externalContextPaths);
    this.updateDisplay();
    this.renderDropdown();

    return { success: true, normalizedPath };
  }

  /**
   * Clear session-only external context paths (call on new session).
   * Uses persistent paths from settings if provided, otherwise falls back to local cache.
   * Validates paths before using them (silently filters invalid during session init).
   */
  clearExternalContexts(persistentPathsFromSettings?: string[]): void {
    // Use settings value if provided (most up-to-date), otherwise use local cache
    if (persistentPathsFromSettings) {
      // Validate paths - silently filter during session initialization (not user action)
      const validPaths = filterValidPaths(persistentPathsFromSettings);
      this.persistentPaths = new Set(validPaths);
    }
    this.externalContextPaths = [...this.persistentPaths];
    this.updateDisplay();
    this.renderDropdown();
  }

  private render() {
    this.container.empty();

    const iconWrapper = this.container.createDiv({ cls: 'pivi-external-context-icon-wrapper' });

    this.iconEl = iconWrapper.createDiv({ cls: 'pivi-external-context-icon' });
    setIcon(this.iconEl, 'folder');

    this.badgeEl = iconWrapper.createDiv({ cls: 'pivi-external-context-badge' });

    this.updateDisplay();

    // Click to open native folder picker
    iconWrapper.addEventListener('click', (e) => {
      e.stopPropagation();
      void this.openFolderPicker();
    });

    this.dropdownEl = this.container.createDiv({ cls: 'pivi-external-context-dropdown' });
    this.renderDropdown();
  }

  private async openFolderPicker() {
    try {
      // Access Electron's dialog through remote
      // eslint-disable-next-line @typescript-eslint/no-require-imports -- Electron remote is exposed only at runtime in Obsidian's renderer.
      const { remote } = require('electron') as { remote?: ElectronRemoteApi };
      if (!remote) {
        throw new Error('Electron remote API is unavailable');
      }
      const result = await remote.dialog.showOpenDialog({
        properties: ['openDirectory'],
        title: 'Select External Context',
      });

      if (!result.canceled && result.filePaths.length > 0) {
        const selectedPath = result.filePaths[0];

        // Check for duplicate (normalized comparison for cross-platform support)
        if (isDuplicatePath(selectedPath, this.externalContextPaths)) {
          new Notice('This folder is already added as an external context.', 3000);
          return;
        }

        // Check for nested/overlapping paths
        const conflict = findConflictingPath(selectedPath, this.externalContextPaths);
        if (conflict) {
          new Notice(this.formatConflictMessage(selectedPath, conflict), 5000);
          return;
        }

        this.externalContextPaths = [...this.externalContextPaths, selectedPath];
        this.onChangeCallback?.(this.externalContextPaths);
        this.updateDisplay();
        this.renderDropdown();
      }
    } catch {
      new Notice('Unable to open folder picker.', 5000);
    }
  }

  /** Formats a conflict error message for display. */
  private formatConflictMessage(newPath: string, conflict: { path: string; type: 'parent' | 'child' }): string {
    const shortNew = this.shortenPath(newPath);
    const shortExisting = this.shortenPath(conflict.path);
    return conflict.type === 'parent'
      ? `Cannot add "${shortNew}" - it's inside existing path "${shortExisting}"`
      : `Cannot add "${shortNew}" - it contains existing path "${shortExisting}"`;
  }

  private renderDropdown() {
    if (!this.dropdownEl) return;

    this.dropdownEl.empty();

    // Header
    const headerEl = this.dropdownEl.createDiv({ cls: 'pivi-external-context-header' });
    headerEl.setText('External contexts');

    // Path list
    const listEl = this.dropdownEl.createDiv({ cls: 'pivi-external-context-list' });

    if (this.externalContextPaths.length === 0) {
      const emptyEl = listEl.createDiv({ cls: 'pivi-external-context-empty' });
      emptyEl.setText('Click folder icon to add');
    } else {
      for (const pathStr of this.externalContextPaths) {
        const itemEl = listEl.createDiv({ cls: 'pivi-external-context-item' });

        const pathTextEl = itemEl.createSpan({ cls: 'pivi-external-context-text' });
        // Show shortened path for display
        const displayPath = this.shortenPath(pathStr);
        pathTextEl.setText(displayPath);
        pathTextEl.setAttribute('title', pathStr);

        // Lock toggle button
        const isPersistent = this.persistentPaths.has(pathStr);
        const lockBtn = itemEl.createSpan({ cls: 'pivi-external-context-lock' });
        if (isPersistent) {
          lockBtn.addClass('locked');
        }
        setIcon(lockBtn, isPersistent ? 'lock' : 'unlock');
        lockBtn.setAttribute('title', isPersistent ? 'Persistent (click to make session-only)' : 'Session-only (click to persist)');
        lockBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          this.togglePersistence(pathStr);
        });

        const removeBtn = itemEl.createSpan({ cls: 'pivi-external-context-remove' });
        setIcon(removeBtn, 'x');
        removeBtn.setAttribute('title', 'Remove path');
        removeBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          this.removePath(pathStr);
        });
      }
    }
  }

  /** Shorten path for display (replace home dir with ~) */
  private shortenPath(fullPath: string): string {
    try {
      const homeDir = os.homedir();
      const normalize = (value: string) => value.replace(/\\/g, '/');
      const normalizedFull = normalize(fullPath);
      const normalizedHome = normalize(homeDir);
      const compareFull = process.platform === 'win32'
        ? normalizedFull.toLowerCase()
        : normalizedFull;
      const compareHome = process.platform === 'win32'
        ? normalizedHome.toLowerCase()
        : normalizedHome;
      if (compareFull.startsWith(compareHome)) {
        // Use normalized path length and normalize the result for consistent display
        const remainder = normalizedFull.slice(normalizedHome.length);
        return '~' + remainder;
      }
    } catch {
      // Fall through to return full path
    }
    return fullPath;
  }

  updateDisplay() {
    if (!this.iconEl || !this.badgeEl) return;

    const count = this.externalContextPaths.length;

    if (count > 0) {
      this.iconEl.addClass('active');
      this.iconEl.setAttribute('title', `${count} external context${count > 1 ? 's' : ''} (click to add more)`);

      // Show badge only when more than 1 path
      if (count > 1) {
        this.badgeEl.setText(String(count));
        this.badgeEl.addClass('visible');
      } else {
        this.badgeEl.removeClass('visible');
      }
    } else {
      this.iconEl.removeClass('active');
      this.iconEl.setAttribute('title', 'Add external contexts (click)');
      this.badgeEl.removeClass('visible');
    }
  }
}

export class McpServerSelector {
  private container: HTMLElement;
  private iconEl: HTMLElement | null = null;
  private badgeEl: HTMLElement | null = null;
  private statusEl: HTMLElement | null = null;
  private dropdownEl: HTMLElement | null = null;
  private mcpManager: McpServerManager | null = null;
  private mcpOAuth: AppMcpOAuth | null = null;
  private mcpProbeProvider: AppMcpServerProbeProvider | null = null;
  private openSettingsCallback: (() => void) | null = null;
  private enabledServers: Set<string> = new Set();
  private onChangeCallback: ((enabled: Set<string>) => void) | null = null;
  private visible = true;

  constructor(parentEl: HTMLElement) {
    this.container = parentEl.createDiv({ cls: 'pivi-mcp-selector' });
    this.render();
  }

  setVisible(visible: boolean): void {
    this.visible = visible;
    if (!visible) {
      this.container.addClass('pivi-hidden');
    } else {
      this.updateDisplay();
    }
  }

  setMcpManager(manager: McpServerManager | null): void {
    this.mcpManager = manager;
    if (!manager && this.enabledServers.size > 0) {
      this.enabledServers.clear();
      this.onChangeCallback?.(this.enabledServers);
    }
    this.pruneEnabledServers();
    this.updateDisplay();
    this.renderDropdown();
  }

  setRecoveryActions(options: {
    mcpOAuth?: AppMcpOAuth | null;
    mcpProbeProvider?: AppMcpServerProbeProvider | null;
    openSettings?: (() => void) | null;
  }): void {
    this.mcpOAuth = options.mcpOAuth ?? null;
    this.mcpProbeProvider = options.mcpProbeProvider ?? null;
    this.openSettingsCallback = options.openSettings ?? null;
    this.renderDropdown();
  }

  setOnChange(callback: (enabled: Set<string>) => void): void {
    this.onChangeCallback = callback;
  }

  getEnabledServers(): Set<string> {
    return new Set(this.enabledServers);
  }

  addMentionedServers(names: Set<string>): void {
    let changed = false;
    for (const name of names) {
      if (!this.enabledServers.has(name)) {
        this.enabledServers.add(name);
        changed = true;
      }
    }
    if (changed) {
      this.updateDisplay();
      this.renderDropdown();
    }
  }

  clearEnabled(): void {
    this.enabledServers.clear();
    this.updateDisplay();
    this.renderDropdown();
  }

  setEnabledServers(names: string[]): void {
    this.enabledServers = new Set(names);
    this.pruneEnabledServers();
    this.updateDisplay();
    this.renderDropdown();
  }

  private pruneEnabledServers(): void {
    if (!this.mcpManager) return;
    const activeNames = new Set(this.mcpManager.getServers().filter((s) => s.enabled).map((s) => s.name));
    let changed = false;
    for (const name of this.enabledServers) {
      if (!activeNames.has(name)) {
        this.enabledServers.delete(name);
        changed = true;
      }
    }
    if (changed) {
      this.onChangeCallback?.(this.enabledServers);
    }
  }

  private render() {
    this.container.empty();

    const iconWrapper = this.container.createDiv({ cls: 'pivi-mcp-selector-icon-wrapper' });

    this.iconEl = iconWrapper.createDiv({ cls: 'pivi-mcp-selector-icon' });
    appendMcpIcon(this.iconEl);

    this.badgeEl = iconWrapper.createDiv({ cls: 'pivi-mcp-selector-badge' });
    this.statusEl = iconWrapper.createDiv({ cls: 'pivi-mcp-selector-status' });

    this.updateDisplay();

    this.dropdownEl = this.container.createDiv({ cls: 'pivi-mcp-selector-dropdown' });
    this.renderDropdown();

    // Re-render dropdown content on hover (CSS handles visibility)
    this.container.addEventListener('mouseenter', () => {
      this.renderDropdown();
    });
  }

  private renderDropdown() {
    if (!this.dropdownEl) return;
    this.pruneEnabledServers();
    this.dropdownEl.empty();

    // Header
    const headerEl = this.dropdownEl.createDiv({ cls: 'pivi-mcp-selector-header' });
    headerEl.setText('MCP servers');

    const summary = this.mcpManager?.getAvailabilitySummary();
    if (summary) {
      const summaryEl = this.dropdownEl.createDiv({ cls: 'pivi-mcp-selector-summary' });
      summaryEl.setText(this.getAvailabilityText(summary));
    }

    // Server list
    const listEl = this.dropdownEl.createDiv({ cls: 'pivi-mcp-selector-list' });

    const allServers = this.mcpManager?.getServers() || [];
    const servers = allServers.filter(s => s.enabled);

    if (servers.length === 0) {
      const emptyEl = listEl.createDiv({ cls: 'pivi-mcp-selector-empty' });
      emptyEl.setText(allServers.length === 0 ? 'No MCP servers configured' : 'All MCP servers disabled');
      return;
    }

    for (const server of servers) {
      this.renderServerItem(listEl, server);
    }
  }

  private renderServerItem(listEl: HTMLElement, server: ManagedMcpServer) {
    const itemEl = listEl.createDiv({ cls: 'pivi-mcp-selector-item' });
    itemEl.dataset.serverName = server.name;

    const isEnabled = this.enabledServers.has(server.name);
    itemEl.setAttribute('role', 'checkbox');
    itemEl.setAttribute('tabindex', '0');
    itemEl.setAttribute('aria-label', `${server.name} MCP server`);
    itemEl.setAttribute('aria-checked', isEnabled ? 'true' : 'false');
    if (isEnabled) {
      itemEl.addClass('enabled');
    }

    // Checkbox
    const checkEl = itemEl.createDiv({ cls: 'pivi-mcp-selector-check' });
    if (isEnabled) {
      appendCheckIcon(checkEl);
    }

    // Info
    const infoEl = itemEl.createDiv({ cls: 'pivi-mcp-selector-item-info' });

    const nameEl = infoEl.createSpan({ cls: 'pivi-mcp-selector-item-name' });
    nameEl.setText(server.name);

    // Badges
    if (server.contextSaving) {
      const csEl = infoEl.createSpan({ cls: 'pivi-mcp-selector-cs-badge' });
      csEl.setText('Mention');
      csEl.setAttribute('title', `Context-saving: active only when selected here or mentioned as @${server.name}`);
    } else {
      const activeEl = infoEl.createSpan({ cls: 'pivi-mcp-selector-cs-badge' });
      activeEl.setText('Active');
      activeEl.setAttribute('title', 'Available to the current turn while this server is enabled in settings');
    }

    const actionsEl = itemEl.createDiv({ cls: 'pivi-mcp-selector-actions' });
    this.renderServerActions(actionsEl, server);

    // Click to toggle (use mousedown for more reliable capture)
    itemEl.addEventListener('mousedown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.toggleServer(server.name, itemEl);
    });
    itemEl.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      e.preventDefault();
      e.stopPropagation();
      this.toggleServer(server.name, itemEl);
    });
  }

  private renderServerActions(actionsEl: HTMLElement, server: ManagedMcpServer): void {
    if (supportsMcpOAuth(server) && this.mcpOAuth) {
      const authButton = actionsEl.createEl('button', {
        cls: 'pivi-mcp-selector-action',
        text: 'Auth',
        type: 'button',
      });
      authButton.setAttribute('aria-label', `Authenticate ${server.name} MCP server`);
      authButton.addEventListener('mousedown', (event) => {
        event.preventDefault();
        event.stopPropagation();
      });
      authButton.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        runToolbarAction(async () => {
          const status = await this.mcpOAuth?.authenticate(server);
          new Notice(
            status === 'authenticated'
              ? `MCP server "${server.name}" authenticated.`
              : `MCP server "${server.name}" authentication status: ${status ?? 'unknown'}.`,
          );
        }, `Failed to authenticate MCP server "${server.name}"`);
      });
    }

    if (this.mcpProbeProvider) {
      const testButton = actionsEl.createEl('button', {
        cls: 'pivi-mcp-selector-action',
        text: 'Test',
        type: 'button',
      });
      testButton.setAttribute('aria-label', `Test ${server.name} MCP server`);
      testButton.addEventListener('mousedown', (event) => {
        event.preventDefault();
        event.stopPropagation();
      });
      testButton.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        runToolbarAction(async () => {
          const result = await this.mcpProbeProvider?.testServer(server.name);
          const toolCount = result?.toolCount ?? 0;
          new Notice(`MCP server "${server.name}" reachable (${toolCount} tool${toolCount === 1 ? '' : 's'}).`);
        }, `Failed to test MCP server "${server.name}"`);
      });
    }

    if (this.openSettingsCallback) {
      const settingsButton = actionsEl.createEl('button', {
        cls: 'pivi-mcp-selector-action',
        text: 'Settings',
        type: 'button',
      });
      settingsButton.setAttribute('aria-label', 'Open MCP settings');
      settingsButton.addEventListener('mousedown', (event) => {
        event.preventDefault();
        event.stopPropagation();
      });
      settingsButton.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        this.openSettingsCallback?.();
      });
    }
  }

  private toggleServer(name: string, itemEl: HTMLElement) {
    if (this.enabledServers.has(name)) {
      this.enabledServers.delete(name);
    } else {
      this.enabledServers.add(name);
    }

    // Update item visually in-place (immediate feedback)
    const isEnabled = this.enabledServers.has(name);
    const checkEl = itemEl.querySelector<HTMLElement>('.pivi-mcp-selector-check');

    if (isEnabled) {
      itemEl.addClass('enabled');
      itemEl.setAttribute('aria-checked', 'true');
      if (checkEl) appendCheckIcon(checkEl);
    } else {
      itemEl.removeClass('enabled');
      itemEl.setAttribute('aria-checked', 'false');
      if (checkEl) checkEl.empty();
    }

    this.updateDisplay();
    this.onChangeCallback?.(this.enabledServers);
  }

  updateDisplay() {
    this.pruneEnabledServers();
    if (!this.iconEl || !this.badgeEl || !this.statusEl) return;

    const count = this.enabledServers.size;
    const summary = this.mcpManager?.getAvailabilitySummary();
    const hasServers = (summary?.totalCount || 0) > 0;

    // Show/hide container based on whether there are servers and visibility
    if (!hasServers || !this.visible) {
      this.container.addClass('pivi-hidden');
      return;
    }
    this.container.removeClass('pivi-hidden');

    const alwaysActiveCount = summary?.alwaysActiveCount ?? 0;
    const selectedMentionOnlyCount = this.getSelectedMentionOnlyCount();
    const effectiveCount = alwaysActiveCount + selectedMentionOnlyCount;
    this.statusEl.setText(effectiveCount > 0 ? String(effectiveCount) : '0');
    this.statusEl.setAttribute('title', this.getEffectiveAvailabilityTitle(alwaysActiveCount, selectedMentionOnlyCount));

    if (count > 0) {
      this.iconEl.addClass('active');
      this.iconEl.setAttribute('title', this.getEffectiveAvailabilityTitle(alwaysActiveCount, selectedMentionOnlyCount));

      // Show badge only when more than 1
      if (count > 1) {
        this.badgeEl.setText(String(count));
        this.badgeEl.addClass('visible');
      } else {
        this.badgeEl.removeClass('visible');
      }
    } else {
      this.iconEl.removeClass('active');
      this.iconEl.setAttribute('title', this.getEffectiveAvailabilityTitle(alwaysActiveCount, selectedMentionOnlyCount));
      this.badgeEl.removeClass('visible');
    }
  }

  private getSelectedMentionOnlyCount(): number {
    const servers = this.mcpManager?.getServers() ?? [];
    return servers.filter((server) => server.enabled && server.contextSaving && this.enabledServers.has(server.name)).length;
  }

  private getAvailabilityText(summary: { enabledCount: number; alwaysActiveCount: number; contextSavingCount: number }): string {
    if (summary.enabledCount === 0) {
      return 'No enabled MCP servers. Enable one in settings to use it in a turn.';
    }

    const parts: string[] = [];
    if (summary.alwaysActiveCount > 0) {
      parts.push(`${summary.alwaysActiveCount} always active`);
    }
    if (summary.contextSavingCount > 0) {
      parts.push(`${summary.contextSavingCount} mention/selection only`);
    }
    return parts.join(' · ');
  }

  private getEffectiveAvailabilityTitle(alwaysActiveCount: number, selectedCount: number): string {
    const effectiveCount = alwaysActiveCount + selectedCount;
    if (effectiveCount > 0) {
      const parts: string[] = [`${effectiveCount} MCP server${effectiveCount > 1 ? 's' : ''} available this turn`];
      if (alwaysActiveCount > 0) {
        parts.push(`${alwaysActiveCount} always active`);
      }
      if (selectedCount > 0) {
        parts.push(`${selectedCount} selected`);
      }
      return `${parts.join(' · ')} (click to manage)`;
    }

    return 'No MCP servers available this turn. Select a mention-only server or enable servers in settings.';
  }
}

export class ContextUsageMeter {
  private container: HTMLElement;
  private fillPath: SVGPathElement | null = null;
  private percentEl: HTMLElement | null = null;
  private circumference: number = 0;

  constructor(parentEl: HTMLElement) {
    this.container = parentEl.createDiv({ cls: 'pivi-context-meter' });
    this.render();
    // Initially hidden
    this.container.addClass('pivi-hidden');
  }

  setVisible(visible: boolean): void {
    this.container.toggleClass('pivi-hidden', !visible);
  }

  private render() {
    const size = 16;
    const strokeWidth = 2;
    const radius = (size - strokeWidth) / 2;
    const cx = size / 2;
    const cy = size / 2;

    // 240° arc: from 150° to 390° (upper-left through bottom to upper-right)
    const startAngle = 150;
    const endAngle = 390;
    const arcDegrees = endAngle - startAngle;
    const arcRadians = (arcDegrees * Math.PI) / 180;
    this.circumference = radius * arcRadians;

    const startRad = (startAngle * Math.PI) / 180;
    const endRad = (endAngle * Math.PI) / 180;
    const x1 = cx + radius * Math.cos(startRad);
    const y1 = cy + radius * Math.sin(startRad);
    const x2 = cx + radius * Math.cos(endRad);
    const y2 = cy + radius * Math.sin(endRad);

    const gaugeEl = this.container.createDiv({ cls: 'pivi-context-meter-gauge' });
    const svg = gaugeEl.ownerDocument.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('width', String(size));
    svg.setAttribute('height', String(size));
    svg.setAttribute('viewBox', `0 0 ${size} ${size}`);

    const pathData = `M ${x1} ${y1} A ${radius} ${radius} 0 1 1 ${x2} ${y2}`;
    const backgroundPath = gaugeEl.ownerDocument.createElementNS('http://www.w3.org/2000/svg', 'path');
    backgroundPath.classList.add('pivi-meter-bg');
    backgroundPath.setAttribute('d', pathData);
    backgroundPath.setAttribute('fill', 'none');
    backgroundPath.setAttribute('stroke-width', String(strokeWidth));
    backgroundPath.setAttribute('stroke-linecap', 'round');

    const fillPath = gaugeEl.ownerDocument.createElementNS('http://www.w3.org/2000/svg', 'path');
    fillPath.classList.add('pivi-meter-fill');
    fillPath.setAttribute('d', pathData);
    fillPath.setAttribute('fill', 'none');
    fillPath.setAttribute('stroke-width', String(strokeWidth));
    fillPath.setAttribute('stroke-linecap', 'round');
    fillPath.setAttribute('stroke-dasharray', String(this.circumference));
    fillPath.setAttribute('stroke-dashoffset', String(this.circumference));

    svg.appendChild(backgroundPath);
    svg.appendChild(fillPath);
    gaugeEl.appendChild(svg);
    this.fillPath = fillPath;

    this.percentEl = this.container.createSpan({ cls: 'pivi-context-meter-percent' });
  }

  update(usage: UsageInfo | null): void {
    if (!usage || usage.contextTokens <= 0) {
      this.container.addClass('pivi-hidden');
      return;
    }
    this.container.removeClass('pivi-hidden');
    const fillLength = (usage.percentage / 100) * this.circumference;
    if (this.fillPath) {
      this.fillPath.setAttribute('stroke-dashoffset', String(this.circumference - fillLength));
    }

    if (this.percentEl) {
      this.percentEl.setText(`${usage.percentage}%`);
    }

    // Toggle warning class for > 80%
    if (usage.percentage > 80) {
      this.container.addClass('warning');
    } else {
      this.container.removeClass('warning');
    }

    // Set tooltip with detailed usage
    let tooltip = `${this.formatTokens(usage.contextTokens)} / ${this.formatTokens(usage.contextWindow)}`;
    if (usage.percentage > 80) {
      tooltip += ' (Approaching limit, run `/compact` to continue)';
    }
    this.container.setAttribute('data-tooltip', tooltip);
  }

  private formatTokens(tokens: number): string {
    if (tokens >= 1000) {
      return `${Math.round(tokens / 1000)}k`;
    }
    return String(tokens);
  }
}

export function createInputToolbar(
  parentEl: HTMLElement,
  callbacks: ToolbarCallbacks
): {
  modelSelector: ModelSelector;
  modeSelector: ModeSelector;
  thinkingBudgetSelector: ThinkingBudgetSelector;
  contextUsageMeter: ContextUsageMeter | null;
  externalContextSelector: ExternalContextSelector;
  mcpServerSelector: McpServerSelector;
  permissionToggle: PermissionToggle;
} {
  const modelSelector = new ModelSelector(parentEl, callbacks);
  const thinkingBudgetSelector = new ThinkingBudgetSelector(parentEl, callbacks);
  const contextUsageMeter = new ContextUsageMeter(parentEl);
  const externalContextSelector = new ExternalContextSelector(parentEl, callbacks);
  const mcpServerSelector = new McpServerSelector(parentEl);
  const permissionToggle = new PermissionToggle(parentEl, callbacks);
  const modeSelector = new ModeSelector(parentEl, callbacks);

  return {
    modelSelector,
    modeSelector,
    thinkingBudgetSelector,
    contextUsageMeter,
    externalContextSelector,
    mcpServerSelector,
    permissionToggle,
  };
}
