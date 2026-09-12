/**
 * Reading what a world has registered.
 *
 * Foundry keeps every registered setting in one map, keyed `namespace.key`.
 * That map is the only way to find settings belonging to packages this module
 * knows nothing about, which is the whole job. Everything here reads it and
 * nothing here writes.
 */
import type { SettingScope } from '@vttforge/types';
import { CORE_NAMESPACES } from './constants.js';

/** One registered setting, plus the value the world currently holds. */
export interface RegisteredSetting {
  /** `namespace.key`, the id Foundry files it under. */
  readonly id: string;
  readonly namespace: string;
  readonly key: string;
  readonly scope: SettingScope;
  /** The label shown in the settings menu, when the setting has one. */
  readonly name: string | undefined;
  /** Whether Foundry draws a row for it. A hidden setting is usually state. */
  readonly config: boolean;
}

interface SettingEntry {
  namespace?: string;
  key?: string;
  scope?: SettingScope;
  name?: string;
  config?: boolean;
}

interface SettingsRegistry {
  settings: Map<string, SettingEntry>;
  get<T>(namespace: string, key: string): T;
  set<T>(namespace: string, key: string, value: T): Promise<T>;
}

function registry(): SettingsRegistry {
  const g = globalThis as { game?: { settings?: unknown } };
  const settings = g.game?.settings as SettingsRegistry | undefined;
  if (!settings?.settings) {
    throw new Error('game.settings is not ready. Read settings during or after "init".');
  }
  return settings;
}

/** Split `namespace.key` on the first dot. A key may contain dots; a namespace may not. */
function splitId(id: string): { namespace: string; key: string } {
  const dot = id.indexOf('.');
  if (dot < 0) return { namespace: id, key: '' };
  return { namespace: id.slice(0, dot), key: id.slice(dot + 1) };
}

/**
 * Every setting registered in this world, in registration order.
 *
 * Core's own settings are left out. They describe the world, not a package, and
 * carrying them to another world would overwrite things like the active system
 * or the permission table.
 */
export function listSettings(): RegisteredSetting[] {
  const out: RegisteredSetting[] = [];
  for (const [id, entry] of registry().settings) {
    const { namespace, key } = splitId(id);
    if (CORE_NAMESPACES.has(namespace)) continue;
    if (key === '') continue;
    out.push({
      id,
      namespace,
      key,
      scope: entry.scope ?? 'world',
      name: entry.name,
      config: entry.config ?? false,
    });
  }
  return out;
}

/** The namespaces that registered at least one setting, sorted. */
export function listNamespaces(): string[] {
  return [...new Set(listSettings().map((s) => s.namespace))].sort();
}

/**
 * The current value of a setting.
 *
 * Foundry throws when a setting was never registered. A package can also throw
 * from its own getter. Either way the caller gets `undefined` and keeps going,
 * because one broken setting must not stop a whole export.
 */
export function readValue(setting: RegisteredSetting): unknown {
  try {
    return registry().get(setting.namespace, setting.key);
  } catch {
    return undefined;
  }
}

/** Write one value back. Throws when the value fails the registered type. */
export function writeValue(setting: RegisteredSetting, value: unknown): Promise<unknown> {
  return registry().set(setting.namespace, setting.key, value);
}
