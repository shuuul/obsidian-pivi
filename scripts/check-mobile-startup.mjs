import { readFileSync } from 'node:fs';
import vm from 'node:vm';

class MobilePluginOwner {
  constructor(app = {}, manifest = {}) {
    this.app = app;
    this.manifest = manifest;
  }

  registerView(type, factory) { this.views ??= []; this.views.push({ type, factory }); }
  addRibbonIcon(icon, title, callback) { this.ribbons ??= []; this.ribbons.push({ icon, title, callback }); }
  addSettingTab(tab) { this.settingTabs ??= []; this.settingTabs.push(tab); }
}

class MemoryAdapter {
  constructor() { this.files = new Map(); this.directories = new Set(['', '.pivi', '.pivi/sessions']); }
  async exists(path) { return this.files.has(path) || this.directories.has(path); }
  async read(path) { if (!this.files.has(path)) throw new Error(`Missing ${path}`); return this.files.get(path); }
  async write(path, value) { this.files.set(path, value); }
  async process(path, fn) { const next = fn(await this.read(path)); await this.write(path, next); return next; }
  async list(path) { const prefix = path ? `${path}/` : ''; return { files: [...this.files.keys()].filter(x => x.startsWith(prefix)), folders: [...this.directories].filter(x => x.startsWith(prefix) && x !== path) }; }
  async stat(path) { const value = this.files.get(path); return value === undefined ? null : { type: 'file', ctime: 1, mtime: 1, size: value.length }; }
  async mkdir(path) { this.directories.add(path); }
  async remove(path) { this.files.delete(path); this.directories.delete(path); }
  async rename(from, to) { if (this.files.has(from)) { this.files.set(to, this.files.get(from)); this.files.delete(from); } }
}

class HostBase { constructor(...args) { this.app = args[0]?.app ?? args[0]; this.containerEl = { empty() {} }; } }
const requestedModules = [];
const desktopEvaluation = [];
const obsidian = new Proxy({
  Platform: { isMobileApp: true, isDesktopApp: false }, Plugin: MobilePluginOwner,
  ItemView: HostBase, Modal: HostBase, PluginSettingTab: HostBase,
  Setting: class { setName() { return this; } setDesc() { return this; } addButton() { return this; } addText() { return this; } },
  normalizePath: value => value.replaceAll('\\', '/').replace(/^\.\//, ''),
  requestUrl: async () => { throw new Error('Unexpected network request during startup'); },
}, { get(target, key) { return key in target ? target[key] : HostBase; } });

function createContext() {
 const moduleRecord = { exports: {} };
 const context = {
  module: moduleRecord,
  exports: moduleRecord.exports,
  require(moduleName) {
    requestedModules.push(moduleName);
    if (moduleName === 'obsidian') {
      return obsidian;
    }
    throw new Error(`Mobile startup eagerly required desktop module: ${moduleName}`);
  },
  console,
  Promise,
  setTimeout,
  clearTimeout,
  fetch: async () => { throw new Error('Unexpected fetch during startup'); },
  URL, TextEncoder, TextDecoder, AbortController, crypto,
  __piviDesktopModuleEvaluations: desktopEvaluation,
 };
 context.globalThis = context;
 return { context, moduleRecord };
}

async function load(app) {
  const { context, moduleRecord } = createContext();
  vm.runInNewContext(readFileSync('main.js', 'utf8'), context, { filename: 'main.js' });
  const PiviPlugin = moduleRecord.exports.default;
  if (typeof PiviPlugin !== 'function') throw new Error('main.js does not export an Obsidian Plugin class');
  const plugin = new PiviPlugin(app, { id: 'pivi', version: 'mobile-startup-check' });
  await plugin.onload();
  return plugin;
}

// Keep the inert host: startup must remain harmless when Obsidian has not supplied Vault APIs.
(await load({})).onunload();

const adapter = new MemoryAdapter();
const local = new Map();
const secrets = new Map();
const app = {
  vault: { adapter, getName: () => 'Mobile vault', getAbstractFileByPath: () => null, on: () => ({}) },
  loadLocalStorage: key => local.get(key) ?? null,
  saveLocalStorage: (key, value) => { local.set(key, value); },
  secretStorage: { getSecret: key => secrets.get(key) ?? null, setSecret: (key, value) => { if (value === null) secrets.delete(key); else secrets.set(key, value); }, listSecrets: () => [...secrets.keys()] },
  fileManager: {}, metadataCache: {},
  workspace: { getActiveFile: () => null, getRightLeaf: () => ({ setViewState: async () => undefined }) },
  plugins: { plugins: {}, enabledPlugins: new Set() },
};
const plugin = await load(app);
if (plugin.views?.length !== 1 || plugin.ribbons?.length !== 1 || plugin.settingTabs?.length !== 1) {
  throw new Error('Substantive Mobile startup did not register view, ribbon, and settings surfaces');
}
plugin.onunload();

const forbiddenModules = requestedModules.filter(moduleName => moduleName !== 'obsidian');
if (forbiddenModules.length > 0) {
  throw new Error(`Mobile startup loaded forbidden modules: ${forbiddenModules.join(', ')}`);
}
if (desktopEvaluation.length > 0) throw new Error(`Desktop modules evaluated: ${desktopEvaluation.join(', ')}`);

console.log('Mobile startup check passed: desktop modules remained unevaluated.');
