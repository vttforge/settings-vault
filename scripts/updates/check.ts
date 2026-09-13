/**
 * Which installed modules have a newer release, and what changed.
 *
 * The whole design is set by one measured number: GitHub allows 60 requests an
 * hour to a browser with no token, and a conditional request that comes back
 * 304 still spends one of them. A world with thirty modules would burn half the
 * budget on every check, so nothing here checks on its own. A result is kept
 * for a day, and a GM asks for a fresh one.
 *
 * Asking for a token would raise the ceiling. It would also mean this module
 * storing a credential, which is the thing the profile side of it exists to
 * keep out of a file. So: no token.
 */

import { CACHE_SETTING, CORE_NAMESPACES, MAX_REQUESTS, MODULE_ID, TTL_MS } from '../constants.js';
import { latestRelease, RateLimitError, type Repo, repoFromUrl } from './github.js';

/** What one module's check produced, as it is stored. */
export interface CachedRelease {
  /** The newest version found, or `null` when the check did not get one. */
  readonly version: string | null;
  readonly notes: string;
  readonly url: string;
  readonly publishedAt: string | null;
  /** Why there is no version. `null` when there is one. */
  readonly error: string | null;
  readonly fetchedAt: string;
}

/** The stored result of the last check. One setting, world scope, hidden. */
export interface UpdateCache {
  /** ISO, or `null` when no check has run in this world. */
  readonly checkedAt: string | null;
  readonly entries: Record<string, CachedRelease>;
}

/** One row of the report, installed version beside the newest found. */
export interface UpdateRow {
  readonly id: string;
  readonly title: string;
  readonly installed: string;
  readonly latest: string | null;
  readonly notes: string;
  readonly url: string;
  readonly publishedAt: string | null;
  /** A newer release exists. */
  readonly outdated: boolean;
  /** Why this module has no answer: no GitHub URL, no release, a refusal. */
  readonly reason: string | null;
}

export interface UpdateReport {
  readonly rows: UpdateRow[];
  readonly checkedAt: string | null;
  /** How many rows carry a newer release. */
  readonly outdatedCount: number;
  /** How many modules were left unchecked because the request cap was hit. */
  readonly skippedForBudget: number;
}

export const EMPTY_CACHE: UpdateCache = { checkedAt: null, entries: {} };

function readCache(): UpdateCache {
  const stored = game.settings.get<UpdateCache>(MODULE_ID, CACHE_SETTING);
  if (!stored || typeof stored !== 'object') return EMPTY_CACHE;
  const entries = (stored as UpdateCache).entries;
  return {
    checkedAt: typeof stored.checkedAt === 'string' ? stored.checkedAt : null,
    entries: entries && typeof entries === 'object' ? entries : {},
  };
}

/**
 * Every installed module, this one included.
 *
 * Leaving itself out was the first version, and it was wrong: a GM wants to
 * know this module is behind for the same reason they want to know about the
 * other thirty.
 */
function checkable(): { id: string; title: string; version: string; repo: Repo | undefined }[] {
  const out: { id: string; title: string; version: string; repo: Repo | undefined }[] = [];
  for (const handle of game.modules.values()) {
    if (CORE_NAMESPACES.has(handle.id)) continue;
    out.push({
      id: handle.id,
      title: handle.title,
      version: handle.version,
      repo: repoFromUrl(handle.url) ?? repoFromUrl(handle.manifest),
    });
  }
  return out.sort((a, b) => a.title.localeCompare(b.title));
}

function isFresh(entry: CachedRelease | undefined, now: number): boolean {
  if (!entry) return false;
  const at = Date.parse(entry.fetchedAt);
  return Number.isFinite(at) && now - at < TTL_MS;
}

/**
 * Read the cache and, unless everything in it is still fresh, ask GitHub about
 * what is not.
 *
 * `force` refetches every module with a GitHub URL, which is the button a GM
 * presses when a release just landed. Without it, an entry younger than a day
 * is reused and costs no request.
 */
export async function checkUpdates({ force = false } = {}): Promise<UpdateReport> {
  // Only a GM can write a world setting, and this writes one at the end. Refuse
  // before spending a single request rather than after spending forty.
  if (!game.user?.isGM) {
    throw new Error('Only a Gamemaster can check for updates: the result is stored in the world.');
  }

  const now = Date.now();
  const cache = readCache();
  const entries: Record<string, CachedRelease> = { ...cache.entries };
  const modules = checkable();

  // Everything that would cost a request, decided before any is made, so what
  // is left over when the loop stops early can be counted.
  const pending = modules.filter(
    (module) => module.repo && (force || !isFresh(entries[module.id], now)),
  );
  const budget = pending.slice(0, MAX_REQUESTS);
  let skippedForBudget = pending.length - budget.length;
  let spent = 0;

  for (const [index, module] of budget.entries()) {
    // Narrowed by the filter above; `pending` holds only modules with a repo.
    const repo = module.repo as Repo;
    spent += 1;
    const fetchedAt = new Date().toISOString();
    try {
      const release = await latestRelease(repo);
      entries[module.id] = { ...release, error: null, fetchedAt };
    } catch (error) {
      if (error instanceof RateLimitError) {
        // Every request after this one gets the same refusal. Stop, and count
        // this module and the rest as unchecked instead of writing a cache
        // entry that would claim they were looked at for the next day.
        skippedForBudget += budget.length - index;
        break;
      }
      entries[module.id] = {
        version: null,
        notes: '',
        url: `https://github.com/${repo.owner}/${repo.repo}`,
        publishedAt: null,
        error: error instanceof Error ? error.message : String(error),
        fetchedAt,
      };
    }
  }

  // `force` means a GM pressed the button. Record that, even when nothing
  // needed fetching, or the window keeps saying a check never ran.
  const checkedAt = force || spent > 0 ? new Date().toISOString() : cache.checkedAt;
  // A GM is the only one who can write a world-scope setting, and the window
  // is GM-only, so this is reached by a GM or not at all.
  await game.settings.set<UpdateCache>(MODULE_ID, CACHE_SETTING, { checkedAt, entries });

  return buildReport(modules, entries, checkedAt, skippedForBudget);
}

/** The last check's result, without asking GitHub anything. */
export function lastReport(): UpdateReport {
  const cache = readCache();
  return buildReport(checkable(), cache.entries, cache.checkedAt, 0);
}

function buildReport(
  modules: ReturnType<typeof checkable>,
  entries: Record<string, CachedRelease>,
  checkedAt: string | null,
  skippedForBudget: number,
): UpdateReport {
  const rows: UpdateRow[] = modules.map((module) => {
    const entry = entries[module.id];
    if (!module.repo) {
      return {
        id: module.id,
        title: module.title,
        installed: module.version,
        latest: null,
        notes: '',
        url: '',
        publishedAt: null,
        outdated: false,
        reason: 'no GitHub address in its manifest',
      };
    }
    if (!entry) {
      return {
        id: module.id,
        title: module.title,
        installed: module.version,
        latest: null,
        notes: '',
        url: `https://github.com/${module.repo.owner}/${module.repo.repo}`,
        publishedAt: null,
        outdated: false,
        reason: 'not checked yet',
      };
    }
    return {
      id: module.id,
      title: module.title,
      installed: module.version,
      latest: entry.version,
      notes: entry.notes,
      url: entry.url,
      publishedAt: entry.publishedAt,
      outdated:
        entry.version !== null && foundry.utils.isNewerVersion(entry.version, module.version),
      reason: entry.error,
    };
  });

  return {
    rows,
    checkedAt,
    outdatedCount: rows.filter((row) => row.outdated).length,
    skippedForBudget,
  };
}
