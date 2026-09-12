/**
 * Reading what a world has registered.
 *
 * Foundry keeps every registered setting in one map, keyed `namespace.key`.
 * That map is the only way to find settings belonging to packages this module
 * knows nothing about, which is the whole job. `@vttforge/types` describes it,
 * so nothing here declares a shape. Everything reads and nothing writes,
 * except `writeValue`.
 */
import type { RegisteredSetting, SettingScope } from '@vttforge/types';
import { CORE_NAMESPACES } from './constants.js';

/** One registered setting, narrowed to what the vault needs from it. */
export interface VaultSetting {
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

function toVaultSetting(entry: RegisteredSetting): VaultSetting {
  return {
    id: entry.id,
    namespace: entry.namespace,
    key: entry.key,
    scope: entry.scope,
    name: entry.name,
    config: entry.config ?? false,
  };
}

/**
 * Every setting registered in this world, in registration order.
 *
 * Core's own settings are left out. They describe the world, not a package,
 * and carrying them to another world would overwrite things like the active
 * system or the permission table.
 */
export function listSettings(): VaultSetting[] {
  const out: VaultSetting[] = [];
  for (const entry of game.settings.settings.values()) {
    if (CORE_NAMESPACES.has(entry.namespace)) continue;
    if (entry.key === '') continue;
    out.push(toVaultSetting(entry));
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
 * A package can throw from its own getter. The caller gets `undefined` and
 * keeps going, because one broken setting must not stop a whole export.
 */
export function readValue(setting: VaultSetting): unknown {
  try {
    return game.settings.get(setting.namespace, setting.key);
  } catch {
    return undefined;
  }
}

/** Write one value back. Throws when the value fails the registered type. */
export function writeValue(setting: VaultSetting, value: unknown): Promise<unknown> {
  return game.settings.set(setting.namespace, setting.key, value);
}
