import { useSyncExternalStore } from 'react';

import type {
  SettingsGeneralSnapshot,
  SettingsSubagentsSnapshot,
  SettingsUiSnapshotData,
} from './types';

export type DeepReadonly<T> = T extends (...args: never[]) => unknown
  ? T
  : T extends readonly (infer Item)[]
    ? readonly DeepReadonly<Item>[]
    : T extends object
      ? { readonly [Key in keyof T]: DeepReadonly<T[Key]> }
      : T;

export type SettingsUiSnapshot = DeepReadonly<SettingsUiSnapshotData>;
export type SettingsUiStoreListener = () => void;

function cloneSerializableValue(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value !== 'object') throw new TypeError(`Settings UI snapshots cannot contain ${typeof value} values`);
  if (Array.isArray(value)) return value.map(cloneSerializableValue);
  const prototype = Reflect.getPrototypeOf(value);
  if (prototype !== null && prototype !== Object.prototype) {
    throw new TypeError('Settings UI snapshots can contain only plain objects and arrays');
  }
  return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, cloneSerializableValue(child)]));
}

function freeze<T>(value: T): DeepReadonly<T> {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) return value as DeepReadonly<T>;
  Object.freeze(value);
  for (const child of Object.values(value)) freeze(child);
  return value as DeepReadonly<T>;
}

function snapshot(data: SettingsUiSnapshotData): SettingsUiSnapshot {
  return freeze(cloneSerializableValue(data) as SettingsUiSnapshotData);
}

/** Immutable external-store boundary for the React settings root. */
export class SettingsUiStore {
  private current: SettingsUiSnapshot;
  private disposed = false;
  private readonly listeners = new Set<SettingsUiStoreListener>();

  constructor(initial: SettingsUiSnapshotData) {
    this.current = snapshot(initial);
  }

  readonly getSnapshot = (): SettingsUiSnapshot => this.current;

  readonly subscribe = (listener: SettingsUiStoreListener): (() => void) => {
    if (this.disposed) return () => undefined;
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  updateGeneral(patch: Partial<SettingsGeneralSnapshot>): SettingsUiSnapshot {
    return this.replace({ ...this.current, general: { ...this.current.general, ...patch } });
  }

  updateSubagents(patch: Partial<SettingsSubagentsSnapshot>): SettingsUiSnapshot {
    return this.replace({ ...this.current, subagents: { ...this.current.subagents, ...patch } });
  }

  replace(next: SettingsUiSnapshotData): SettingsUiSnapshot {
    if (this.disposed) return this.current;
    this.current = snapshot(next);
    for (const listener of this.listeners) listener();
    return this.current;
  }

  dispose(): void {
    this.disposed = true;
    this.listeners.clear();
  }
}

export function useSettingsUiSnapshot(store: SettingsUiStore): SettingsUiSnapshot {
  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
}
