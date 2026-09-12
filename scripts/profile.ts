/**
 * The file a vault writes and reads.
 *
 * A profile is a flat list of setting values plus enough context for a human to
 * tell two files apart. It is plain JSON on purpose: a GM can open it, read it,
 * delete a line and send it to someone else.
 *
 * Three scopes behave differently and the difference is not hidden:
 *
 * - `world` travels. Same value for everyone, and only a GM may write it.
 * - `client` travels, and lands on the device doing the import. Another player
 *   importing the same file gets it on their own device.
 * - `user` belongs to whoever is logged in. Foundry writes user-scope settings
 *   against the current user and offers no way to write another user's, so a
 *   profile carries the exporter's own values and the importer receives them as
 *   their own. A player's settings cannot be moved for them.
 */
import type { SettingScope } from '@vttforge/types';
import { PROFILE_FORMAT } from './constants.js';
import { listSettings, readValue, type VaultSetting, writeValue } from './settings-registry.js';

export interface ProfileEntry {
  /** `namespace.key`. */
  readonly id: string;
  readonly scope: SettingScope;
  readonly value: unknown;
}

export interface Profile {
  readonly format: number;
  readonly createdAt: string;
  readonly label: string;
  /** The Foundry generation the profile came from, for example `14`. */
  readonly foundry: string;
  readonly system: { readonly id: string; readonly version: string };
  readonly entries: readonly ProfileEntry[];
}

export interface ExportOptions {
  /** Namespaces to include. Empty means every namespace. */
  readonly namespaces?: readonly string[];
  /** Include values whose key looks like a credential. Off by default. */
  readonly includeSecrets?: boolean;
  readonly label?: string;
}

export interface SkippedEntry {
  readonly id: string;
  readonly reason: string;
}

export interface ImportReport {
  readonly applied: readonly string[];
  readonly skipped: readonly SkippedEntry[];
}

/**
 * Key names that usually hold a credential.
 *
 * Some modules keep an API token in a setting. An export is a file a GM might
 * paste into a chat window, so those values stay out unless asked for. The test
 * is the key name, which catches the common cases and nothing subtle. Read a
 * profile before sharing it.
 */
const SECRET_PATTERN = /(api|access|auth|secret|token|password|passwd|credential|licen[cs]e)/i;

export function looksSecret(setting: VaultSetting): boolean {
  return SECRET_PATTERN.test(setting.key);
}

function gameInfo(): { version: string; systemId: string; systemVersion: string } {
  const g = globalThis as {
    game?: { version?: string; system?: { id?: string; version?: string } };
  };
  return {
    version: g.game?.version ?? 'unknown',
    systemId: g.game?.system?.id ?? 'unknown',
    systemVersion: g.game?.system?.version ?? 'unknown',
  };
}

/** Read the world and build a profile. Does not write anything. */
export function buildProfile(options: ExportOptions = {}): Profile {
  const wanted = options.namespaces?.length ? new Set(options.namespaces) : undefined;
  const info = gameInfo();
  const entries: ProfileEntry[] = [];

  for (const setting of listSettings()) {
    if (wanted && !wanted.has(setting.namespace)) continue;
    if (!options.includeSecrets && looksSecret(setting)) continue;
    const value = readValue(setting);
    if (value === undefined) continue;
    entries.push({ id: setting.id, scope: setting.scope, value });
  }

  return {
    format: PROFILE_FORMAT,
    createdAt: new Date().toISOString(),
    label: options.label ?? '',
    foundry: info.version,
    system: { id: info.systemId, version: info.systemVersion },
    entries,
  };
}

/** Whether a parsed object is a profile this version can read. */
export function isProfile(data: unknown): data is Profile {
  if (typeof data !== 'object' || data === null) return false;
  const p = data as Partial<Profile>;
  return p.format === PROFILE_FORMAT && Array.isArray(p.entries);
}

/**
 * Write a profile back into the world.
 *
 * Every entry is applied on its own. A value that no longer fits its setting
 * throws, and Foundry throws for a setting whose package is not installed. Both
 * are expected when a profile is older than the world, so each failure becomes
 * a line in the report and the rest of the import continues. An import that
 * stopped on the first bad key would be useless as a restore.
 */
export async function applyProfile(profile: Profile): Promise<ImportReport> {
  const known = new Map(listSettings().map((s) => [s.id, s]));
  const applied: string[] = [];
  const skipped: SkippedEntry[] = [];

  for (const entry of profile.entries) {
    const setting = known.get(entry.id);
    if (!setting) {
      skipped.push({ id: entry.id, reason: 'not registered in this world' });
      continue;
    }
    if (setting.scope !== entry.scope) {
      skipped.push({ id: entry.id, reason: `scope changed to ${setting.scope}` });
      continue;
    }
    try {
      await writeValue(setting, entry.value);
      applied.push(entry.id);
    } catch (err) {
      skipped.push({ id: entry.id, reason: err instanceof Error ? err.message : String(err) });
    }
  }

  return { applied, skipped };
}
