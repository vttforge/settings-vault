/**
 * The update check, and the budget that shapes it.
 *
 * GitHub allows a browser sixty requests an hour. Every rule here exists to
 * spend as few of them as possible and to never claim a module was checked
 * when it was not, so the assertions count requests as much as they read rows.
 */
import { withMockFoundry } from '@vttforge/testing/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CACHE_SETTING, MODULE_ID } from '../../constants.js';
import { checkUpdates, EMPTY_CACHE, lastReport, type UpdateCache } from '../check.js';

/**
 * One installed module, as Foundry builds a handle from a manifest.
 *
 * A type, not an interface. `MockModuleOptions` carries an index signature and
 * an interface does not satisfy one, so an interface here fails to compile at
 * the call below.
 */
type Handle = {
  id: string;
  title: string;
  version: string;
  url?: string;
  manifest?: string;
};

const realFetch = globalThis.fetch;
let mock: ReturnType<typeof withMockFoundry> | undefined;

function start(handles: Handle[], options: { isGM?: boolean } = {}): void {
  mock = withMockFoundry({
    user: { isGM: options.isGM ?? true },
    modules: handles,
  });
  game.settings.register(MODULE_ID, CACHE_SETTING, {
    scope: 'world',
    config: false,
    type: Object,
    default: EMPTY_CACHE,
  });
}

/** A release answer, and a counter for how many requests were spent. */
function releases(answer: (url: string) => Response): { calls: () => number } {
  let calls = 0;
  globalThis.fetch = vi.fn(async (input: unknown) => {
    calls += 1;
    return answer(String(input));
  }) as unknown as typeof globalThis.fetch;
  return { calls: () => calls };
}

function release(version: string): Response {
  return new Response(JSON.stringify({ tag_name: `v${version}`, body: 'notes' }), { status: 200 });
}

function cached(id: string, version: string, fetchedAt: string): UpdateCache {
  return {
    checkedAt: fetchedAt,
    entries: {
      [id]: { version, notes: '', url: '', publishedAt: null, error: null, fetchedAt },
    },
  };
}

const OURS: Handle = {
  id: 'settings-vault',
  title: 'Settings Vault',
  version: '0.2.0',
  url: 'https://github.com/vttforge/settings-vault',
};

afterEach(() => {
  globalThis.fetch = realFetch;
  vi.restoreAllMocks();
  mock?.restore();
  mock = undefined;
});

beforeEach(() => {
  globalThis.fetch = realFetch;
});

describe('who may check', () => {
  it('refuses a player before a single request is spent', async () => {
    start([OURS], { isGM: false });
    const spent = releases(() => release('9.0.0'));

    await expect(checkUpdates({ force: true })).rejects.toThrow(/Only a Gamemaster/);
    expect(spent.calls()).toBe(0);
  });
});

describe('what costs a request', () => {
  it('asks once per module with a GitHub address', async () => {
    start([OURS, { id: 'other', title: 'Other', version: '1.0.0', url: 'https://example.com' }]);
    const spent = releases(() => release('0.3.0'));

    const report = await checkUpdates({ force: true });

    expect(spent.calls()).toBe(1);
    expect(report.rows.find((r) => r.id === 'other')?.reason).toBe(
      'no GitHub address in its manifest',
    );
  });

  it('reuses an answer younger than a day', async () => {
    start([OURS]);
    await game.settings.set(
      MODULE_ID,
      CACHE_SETTING,
      cached(OURS.id, '0.9.0', new Date().toISOString()),
    );
    const spent = releases(() => release('1.0.0'));

    const report = await checkUpdates();

    expect(spent.calls()).toBe(0);
    expect(report.rows[0]?.latest).toBe('0.9.0');
  });

  it('asks again when a GM presses the button', async () => {
    start([OURS]);
    await game.settings.set(
      MODULE_ID,
      CACHE_SETTING,
      cached(OURS.id, '0.9.0', new Date().toISOString()),
    );
    const spent = releases(() => release('1.0.0'));

    const report = await checkUpdates({ force: true });

    expect(spent.calls()).toBe(1);
    expect(report.rows[0]?.latest).toBe('1.0.0');
  });

  it('asks again when the answer is older than a day', async () => {
    start([OURS]);
    const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();
    await game.settings.set(MODULE_ID, CACHE_SETTING, cached(OURS.id, '0.9.0', twoDaysAgo));
    const spent = releases(() => release('1.0.0'));

    await checkUpdates();

    expect(spent.calls()).toBe(1);
  });
});

describe('a spent budget', () => {
  it('stops at the first refusal and caches nothing for the rest', async () => {
    // Every request after this one gets the same answer. Writing a cache entry
    // for the rest would mark them checked for a day when none of them were.
    const others: Handle[] = [1, 2, 3].map((n) => ({
      id: `module-${n}`,
      title: `Module ${n}`,
      version: '1.0.0',
      url: `https://github.com/owner/module-${n}`,
    }));
    start(others);
    const spent = releases(
      () => new Response('{}', { status: 403, headers: { 'x-ratelimit-remaining': '0' } }),
    );

    const report = await checkUpdates({ force: true });

    expect(spent.calls()).toBe(1);
    expect(report.skippedForBudget).toBe(3);
    expect(game.settings.get<UpdateCache>(MODULE_ID, CACHE_SETTING).entries).toEqual({});
  });
});

describe('what a row says', () => {
  it('marks a module behind its newest release', async () => {
    start([OURS]);
    releases(() => release('0.3.0'));

    const report = await checkUpdates({ force: true });

    expect(report.rows[0]).toMatchObject({ installed: '0.2.0', latest: '0.3.0', outdated: true });
    expect(report.outdatedCount).toBe(1);
  });

  it('does not mark a module that is ahead of its newest release', async () => {
    // A local build carrying the next version is normal while a release is
    // being prepared.
    start([{ ...OURS, version: '0.4.0' }]);
    releases(() => release('0.3.0'));

    const report = await checkUpdates({ force: true });

    expect(report.rows[0]?.outdated).toBe(false);
    expect(report.outdatedCount).toBe(0);
  });

  it('carries the reason rather than a version it could not read', async () => {
    start([OURS]);
    releases(() => new Response('{}', { status: 404 }));

    const report = await checkUpdates({ force: true });

    expect(report.rows[0]?.latest).toBeNull();
    expect(report.rows[0]?.reason).toBe('no published release');
    expect(report.rows[0]?.outdated).toBe(false);
  });

  it('records the check even when nothing needed fetching', async () => {
    start([{ id: 'other', title: 'Other', version: '1.0.0' }]);

    const report = await checkUpdates({ force: true });

    expect(report.checkedAt).not.toBeNull();
  });
});

describe('lastReport', () => {
  it('reads the world and asks GitHub nothing', async () => {
    start([OURS]);
    await game.settings.set(
      MODULE_ID,
      CACHE_SETTING,
      cached(OURS.id, '9.0.0', new Date().toISOString()),
    );
    const spent = releases(() => release('1.0.0'));

    const report = lastReport();

    expect(spent.calls()).toBe(0);
    expect(report.rows[0]?.latest).toBe('9.0.0');
    expect(report.rows[0]?.outdated).toBe(true);
  });

  it('says no check has run in a fresh world, and still lists every module', () => {
    start([OURS]);

    const report = lastReport();

    expect(report.checkedAt).toBeNull();
    expect(report.rows).toHaveLength(1);
    expect(report.rows[0]?.reason).toBe('not checked yet');
  });
});
