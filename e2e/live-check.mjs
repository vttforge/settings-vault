/**
 * Run this module in a real Foundry v14 world and drive its own API.
 *
 * What no static check can reach: reading the live settings registry, writing
 * values back through Foundry's own validation, and the two refusals that only
 * fire against a real user and a real rate limit.
 *
 * Local only. Booting Foundry needs a licence and an account, so this cannot
 * run in CI on a fresh clone. It needs:
 *
 *   docker on the PATH
 *   FOUNDRY_LICENSE_KEY, FOUNDRY_USERNAME, FOUNDRY_PASSWORD in the environment
 *   FOUNDRY_ACCEPT_LICENSE=1, or pass acceptLicense below
 *
 * Then:
 *
 *   pnpm run build
 *   set -a && . .env && set +a
 *   pnpm run e2e
 *
 * The first run downloads Foundry and takes a couple of minutes. Later runs
 * reuse the data volume.
 *
 * Exits non-zero when a check fails, and when it throws before the first one.
 */
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import { foundryContainerLogs, startFoundryContainer } from '@vttforge/testing/container';

const MODULE_ID = 'settings-vault';
const MODULE_DIST = fileURLToPath(new URL('../dist', import.meta.url));

/**
 * A world needs a system, and this module ships none. The fixture beside this
 * file is the smallest one that will launch, and it registers a setting of each
 * scope so a profile has something to carry.
 */
const SYSTEM_FIXTURE = fileURLToPath(new URL('./fixtures/system', import.meta.url));

/** Named for this repo, so a run never fights another project's container. */
const CONTAINER = 'settings-vault-e2e';

/**
 * Its own port. The name and the volume being distinct is not enough: the
 * published harness defaults every run to the same published port, so two
 * projects with different container names still collide on it.
 */
const PORT = Number(process.env.E2E_PORT ?? 30011);

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
}

// Foundry scans its packages directory once, at startup. Passing both here
// installs them before the world launches, so nothing needs a restart.
const foundry = await startFoundryContainer({
  acceptLicense: true,
  name: CONTAINER,
  port: PORT,
  worldId: 'settings-vault-e2e',
  worldTitle: 'Settings Vault end-to-end',
  packages: [
    { kind: 'system', id: 'settings-vault-fixture', from: SYSTEM_FIXTURE },
    { kind: 'module', id: MODULE_ID, from: MODULE_DIST },
  ],
});
const url = foundry.baseUrl;
console.log(`foundry at ${url} running ${foundry.system.id}@${foundry.system.version}`);

const browser = await chromium.launch();
const page = await browser.newPage();
page.on('pageerror', (err) => console.log('[pageerror]', err.message));

try {
  // Join as the Gamemaster, the same way the repo's own e2e tests do.
  const join = async () => {
    await page.goto(`${url}/join`);
    await page.waitForSelector('form[name=join] input[name=username]');
    await page.fill('form[name=join] input[name=username]', 'Gamemaster');
    await page.click('form[name=join] button[name=join]');
    await page.waitForURL('**/game');
    await page.waitForFunction(() => globalThis.game?.ready === true, null, { timeout: 120_000 });
  };

  await join();
  check(
    'Foundry sees the module directory',
    await page.evaluate((id) => Boolean(game.modules.get(id)), MODULE_ID),
  );

  if (!(await page.evaluate((id) => game.modules.get(id)?.active === true, MODULE_ID))) {
    await page.evaluate(async (id) => {
      const configuration = game.settings.get('core', 'moduleConfiguration');
      await game.settings.set('core', 'moduleConfiguration', { ...configuration, [id]: true });
    }, MODULE_ID);
    await join();
  }

  const active = await page.evaluate((id) => game.modules.get(id)?.active === true, MODULE_ID);
  check('the module is active in the world', active);

  const api = await page.evaluate((id) => {
    const a = game.modules.get(id)?.api;
    return { present: Boolean(a), keys: a ? Object.keys(a).sort() : [] };
  }, MODULE_ID);
  check('registerModule exposed the API', api.present, api.keys.join(', '));

  // buildProfile reads the live registry.
  const profile = await page.evaluate((id) => {
    const p = game.modules.get(id).api.buildProfile({ label: 'live check' });
    const scopes = {};
    for (const e of p.entries) scopes[e.scope] = (scopes[e.scope] ?? 0) + 1;
    return {
      format: p.format,
      label: p.label,
      foundry: p.foundry,
      system: p.system,
      count: p.entries.length,
      scopes,
      namespaces: [...new Set(p.entries.map((e) => e.id.split('.')[0]))].sort(),
      sample: p.entries.slice(0, 3),
    };
  }, MODULE_ID);
  check(
    'buildProfile read the settings registry',
    profile.count > 0,
    `${profile.count} entries, scopes ${JSON.stringify(profile.scopes)}`,
  );
  check(
    'core settings are excluded',
    !profile.namespaces.includes('core'),
    `namespaces: ${profile.namespaces.join(', ')}`,
  );
  check(
    'the profile records the world it came from',
    profile.foundry !== 'unknown' && profile.system.id !== 'unknown',
    `foundry ${profile.foundry}, system ${profile.system.id}@${profile.system.version}`,
  );
  console.log('sample entries:', JSON.stringify(profile.sample));

  // A round trip: change a value, apply the old profile, confirm it came back.
  // Type-agnostic, because a minimal world may hold no boolean at all.
  const roundTrip = await page.evaluate(async (id) => {
    const api = game.modules.get(id).api;
    const before = api.buildProfile();
    const target = before.entries.find((e) => e.scope === 'world');
    if (!target) return { skipped: 'this world registered no world-scope setting' };

    const [ns, ...rest] = target.id.split('.');
    const key = rest.join('.');
    const other =
      typeof target.value === 'boolean'
        ? !target.value
        : typeof target.value === 'number'
          ? target.value + 1
          : typeof target.value === 'string'
            ? `${target.value}-changed`
            : null;
    if (other === null) return { skipped: `cannot vary a ${typeof target.value}` };

    await game.settings.set(ns, key, other);
    const changed = game.settings.get(ns, key);
    const report = await api.applyProfile(before);
    return {
      id: target.id,
      type: typeof target.value,
      original: target.value,
      changed,
      restored: game.settings.get(ns, key),
      applied: report.applied.length,
      skipped: report.skipped,
    };
  }, MODULE_ID);

  if (!roundTrip.id) {
    check('round trip', false, roundTrip.skipped);
  } else {
    check(
      'applyProfile restored a changed value',
      roundTrip.restored === roundTrip.original && roundTrip.changed !== roundTrip.original,
      `${roundTrip.id} (${roundTrip.type}): ${JSON.stringify(roundTrip.original)} -> ${JSON.stringify(roundTrip.changed)} -> ${JSON.stringify(roundTrip.restored)}`,
    );
    check(
      'applyProfile reported what it wrote',
      roundTrip.applied > 0,
      `${roundTrip.applied} applied, ${roundTrip.skipped.length} skipped`,
    );
    if (roundTrip.skipped.length)
      console.log('skipped:', JSON.stringify(roundTrip.skipped.slice(0, 5)));
  }

  // An unknown key is skipped with a reason rather than throwing.
  const unknown = await page.evaluate(async (id) => {
    const report = await game.modules.get(id).api.applyProfile({
      format: 1,
      createdAt: new Date().toISOString(),
      label: '',
      foundry: '14',
      system: { id: 'x', version: '1' },
      entries: [{ id: 'not-installed.someKey', scope: 'world', value: 1 }],
    });
    return report;
  }, MODULE_ID);
  check(
    'a setting from a missing package is skipped, not thrown',
    unknown.applied.length === 0 && unknown.skipped.length === 1,
    JSON.stringify(unknown.skipped[0]),
  );

  // The window opens and draws the package list.
  const windowState = await page.evaluate(async (id) => {
    game.modules.get(id).api.open();
    await new Promise((r) => setTimeout(r, 1500));
    const el = document.querySelector('#settings-vault');
    if (!el) return { rendered: false };
    return {
      rendered: true,
      rows: el.querySelectorAll('input[name="namespace"]').length,
      hasExport: Boolean(el.querySelector('[data-action="exportProfile"]')),
      hasImport: Boolean(el.querySelector('[data-action="importProfile"]')),
      secretsHint: el.querySelector('input[name="includeSecrets"]') !== null,
    };
  }, MODULE_ID);
  check('the vault window renders', windowState.rendered === true, JSON.stringify(windowState));

  // --- the update checker ---

  const menus = await page.evaluate((id) => {
    const found = [];
    for (const [key, entry] of game.settings.menus ?? []) {
      if (key.startsWith(`${id}.`)) found.push({ key, restricted: entry.restricted === true });
    }
    return found;
  }, MODULE_ID);
  check(
    'both settings menus are registered and GM only',
    menus.length === 2 && menus.every((m) => m.restricted),
    menus.map((m) => m.key).join(', '),
  );

  const cacheSetting = await page.evaluate((id) => {
    const entry = game.settings.settings.get(`${id}.updateCache`);
    return entry ? { scope: entry.scope, config: entry.config === true } : null;
  }, MODULE_ID);
  check(
    'the update cache is a hidden world setting',
    cacheSetting?.scope === 'world' && cacheSetting.config === false,
    JSON.stringify(cacheSetting),
  );

  // The manifest fields the checker reads. Nothing static can prove Foundry
  // keeps them on a module handle.
  const manifestFields = await page.evaluate((id) => {
    const handle = game.modules.get(id);
    return { url: handle?.url ?? null, manifest: handle?.manifest ?? null };
  }, MODULE_ID);
  check(
    'a module handle carries url and manifest',
    typeof manifestFields.url === 'string' && manifestFields.url.includes('github.com'),
    JSON.stringify(manifestFields),
  );

  const before = await page.evaluate((id) => {
    const report = game.modules.get(id).api.lastReport();
    return {
      checkedAt: report.checkedAt,
      count: report.rows.length,
      reasons: report.rows.map((r) => ({ id: r.id, reason: r.reason })),
    };
  }, MODULE_ID);
  check(
    'opening costs nothing: no check has run yet',
    before.checkedAt === null && before.count > 0,
    `${before.count} rows, checkedAt ${before.checkedAt}`,
  );
  check(
    'every unchecked row says why',
    before.reasons.every((r) => typeof r.reason === 'string' && r.reason.length > 0),
    JSON.stringify(before.reasons),
  );

  // One real request to GitHub. This repo is private, so an unauthenticated
  // call gets 404 and the row has to say so rather than claim a version.
  const checked = await page.evaluate(
    (id) => game.modules.get(id).api.checkUpdates({ force: true }),
    MODULE_ID,
  );
  const own = checked.rows.find((r) => r.id === MODULE_ID) ?? null;
  check(
    'a check writes a timestamp',
    typeof checked.checkedAt === 'string' && checked.checkedAt.length > 0,
    String(checked.checkedAt),
  );
  check(
    'a repository with no readable release reports the reason, not a version',
    own === null || (own.latest === null && typeof own.reason === 'string'),
    own ? `${own.id}: latest=${JSON.stringify(own.latest)} reason=${own.reason}` : 'own row absent',
  );
  check(
    'no row claims to be outdated without a version',
    checked.rows.every((r) => !r.outdated || typeof r.latest === 'string'),
    `${checked.outdatedCount} outdated of ${checked.rows.length}`,
  );

  const persisted = await page.evaluate(
    (id) => game.modules.get(id).api.lastReport().checkedAt,
    MODULE_ID,
  );
  check(
    'the result survives in the world setting',
    persisted === checked.checkedAt,
    `${persisted} vs ${checked.checkedAt}`,
  );

  // A player cannot check, because the result lands in a world setting. The
  // refusal has to come before any request is spent, so this asserts it throws
  // rather than that it fails at the write.
  const asPlayer = await page.evaluate(async (id) => {
    const real = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(game.user), 'isGM');
    Object.defineProperty(game.user, 'isGM', { get: () => false, configurable: true });
    try {
      await game.modules.get(id).api.checkUpdates({ force: true });
      return { threw: false, message: '' };
    } catch (err) {
      return { threw: true, message: String(err?.message ?? err) };
    } finally {
      delete game.user.isGM;
      if (real) Object.defineProperty(game.user, 'isGM', real);
    }
  }, MODULE_ID);
  check(
    'a player is refused before any request is spent',
    asPlayer.threw && asPlayer.message.includes('Gamemaster'),
    asPlayer.message,
  );
  check(
    'the refusal did not leave the user stuck as a player',
    await page.evaluate(() => game.user.isGM === true),
  );

  // A spent budget stops the loop. Every request after the first refusal gets
  // the same answer, and caching that answer against each remaining module
  // would mark them checked for a day when none of them were.
  const limited = await page.evaluate(async (id) => {
    await game.settings.set(id, 'updateCache', { checkedAt: null, entries: {} });
    const realFetch = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = (input, init) => {
      const url = typeof input === 'string' ? input : (input?.url ?? '');
      if (url.startsWith('https://api.github.com/')) {
        calls += 1;
        return Promise.resolve(
          new Response('{}', { status: 403, headers: { 'x-ratelimit-remaining': '0' } }),
        );
      }
      return realFetch(input, init);
    };
    try {
      const report = await game.modules.get(id).api.checkUpdates({ force: true });
      const cache = game.settings.get(id, 'updateCache');
      return {
        calls,
        skippedForBudget: report.skippedForBudget,
        cached: Object.keys(cache.entries).length,
      };
    } finally {
      globalThis.fetch = realFetch;
    }
  }, MODULE_ID);
  check(
    'a spent budget stops after one request and caches nothing',
    limited.calls === 1 && limited.cached === 0 && limited.skippedForBudget >= 1,
    JSON.stringify(limited),
  );

  // Seed the cache with a version above the installed one, so the outdated
  // path and the notes block are actually exercised. Nothing else in this world
  // has a newer release to find.
  const seeded = await page.evaluate(async (id) => {
    const cache = game.settings.get(id, 'updateCache');
    await game.settings.set(id, 'updateCache', {
      checkedAt: new Date().toISOString(),
      entries: {
        ...cache.entries,
        [id]: {
          version: '99.0.0',
          notes: 'Seeded by the live check.\n- one line\n- another',
          url: 'https://github.com/vttforge/settings-vault/releases/tag/v99.0.0',
          publishedAt: new Date().toISOString(),
          error: null,
          fetchedAt: new Date().toISOString(),
        },
      },
    });
    const report = game.modules.get(id).api.lastReport();
    const row = report.rows.find((r) => r.id === id);
    return { outdatedCount: report.outdatedCount, row };
  }, MODULE_ID);
  check(
    'a higher release marks the row outdated and carries the notes',
    seeded.outdatedCount === 1 &&
      seeded.row?.outdated === true &&
      seeded.row.latest === '99.0.0' &&
      seeded.row.notes.includes('one line'),
    JSON.stringify({ outdatedCount: seeded.outdatedCount, latest: seeded.row?.latest }),
  );

  const outdatedWindow = await page.evaluate(async (id) => {
    game.modules.get(id).api.openUpdates();
    await new Promise((r) => setTimeout(r, 1200));
    const el = document.querySelector('#settings-vault-updates');
    const row = el?.querySelector('.settings-vault__update--outdated');
    return {
      marked: Boolean(row),
      hasNotes: Boolean(row?.querySelector('.settings-vault__notes')),
      hasLink: Boolean(row?.querySelector('a[href*="releases/tag"]')),
    };
  }, MODULE_ID);
  check(
    'the window draws the outdated row, its notes and the release link',
    outdatedWindow.marked && outdatedWindow.hasNotes && outdatedWindow.hasLink,
    JSON.stringify(outdatedWindow),
  );

  // Put the cache back so a re-run starts from a clean world.
  await page.evaluate(
    (id) => game.settings.set(id, 'updateCache', { checkedAt: null, entries: {} }),
    MODULE_ID,
  );

  const updatesWindow = await page.evaluate(async (id) => {
    game.modules.get(id).api.openUpdates();
    await new Promise((r) => setTimeout(r, 1500));
    const el = document.querySelector('#settings-vault-updates');
    if (!el) return { rendered: false };
    return {
      rendered: true,
      rows: el.querySelectorAll('.settings-vault__updates li').length,
      hasRefresh: Boolean(el.querySelector('[data-action="refresh"]')),
      text: (el.textContent ?? '').replace(/\s+/g, ' ').slice(0, 160),
    };
  }, MODULE_ID);
  check(
    'the updates window renders with a refresh button',
    updatesWindow.rendered === true && updatesWindow.hasRefresh === true,
    JSON.stringify(updatesWindow),
  );

  const consoleErrors = await page.evaluate(() => globalThis.__vaultErrors ?? []);
  check('no module error in the console', consoleErrors.length === 0, consoleErrors.join(' | '));
} catch (err) {
  console.log('\n--- threw ---');
  console.log(err?.message ?? String(err));
  console.log('\n--- container logs ---');
  console.log(foundryContainerLogs(CONTAINER, 30));
  // Without this a throw before the first check leaves `results` empty, and
  // "0/0 checks passed" would exit 0. A run that died proved nothing.
  check('the run finished without throwing', false, err?.message ?? String(err));
} finally {
  await browser.close();
  // The container is this script's now, so this script takes it down. The data
  // volume survives, so the next run does not download Foundry again.
  if (process.env.KEEP_FOUNDRY === '1') {
    console.log(`KEEP_FOUNDRY=1, leaving ${CONTAINER} running at ${foundry.baseUrl}`);
  } else {
    foundry.stop();
  }
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exitCode = failed.length === 0 ? 0 : 1;
