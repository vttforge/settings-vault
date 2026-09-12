/**
 * Run this module in a real Foundry v14 world and drive its own API.
 *
 * What no static check can reach: reading the live settings registry, and
 * writing values back through Foundry's own validation.
 *
 * Local only. Booting Foundry needs a licence and an account, so this cannot
 * run in CI on a fresh clone. It also borrows the SDK repo's container
 * harness, which is not published yet, so it expects a sibling checkout:
 *
 *   ../vttforge            the SDK, with apps/e2e installed
 *   .env in that repo      FOUNDRY_LICENSE_KEY, FOUNDRY_USERNAME, FOUNDRY_PASSWORD
 *
 * Then, from the SDK's apps/e2e directory:
 *
 *   set -a && . ../../.env && set +a
 *   node ../../../settings-vault/e2e/live-check.mjs
 *
 * Exits non-zero when a check fails.
 */
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from '@playwright/test';

/**
 * The container harness lives in the SDK repo and is not published, so it is
 * loaded from a sibling checkout by path. `VTTFORGE_REPO` overrides where.
 */
const sdkRepo =
  process.env.VTTFORGE_REPO ?? fileURLToPath(new URL('../../vttforge', import.meta.url));
const harnessPath = `${sdkRepo}/apps/e2e/scripts/foundry.mjs`;
if (!existsSync(harnessPath)) {
  console.error(`The container harness is not at ${harnessPath}.`);
  console.error('Check out the SDK beside this repo, or set VTTFORGE_REPO.');
  process.exit(2);
}
const { logs, start } = await import(pathToFileURL(harnessPath).href);

const CONTAINER = 'vttforge-e2e';
const MODULE_ID = 'settings-vault';
const MODULE_DIST = fileURLToPath(new URL('../dist', import.meta.url));

function docker(args) {
  return execFileSync('docker', args, { encoding: 'utf8' });
}

function install() {
  docker([
    'exec',
    CONTAINER,
    'sh',
    '-lc',
    `rm -rf /data/Data/modules/${MODULE_ID} && mkdir -p /data/Data/modules/${MODULE_ID}`,
  ]);
  docker(['cp', `${MODULE_DIST}/.`, `${CONTAINER}:/data/Data/modules/${MODULE_ID}`]);
  const listed = docker(['exec', CONTAINER, 'sh', '-lc', `ls /data/Data/modules/${MODULE_ID}`]);
  console.log('installed:', listed.trim().split('\n').join(' '));
}

/**
 * Foundry scans the packages directory once, at startup, so a module copied
 * into a running container is invisible until it restarts. The lock is a
 * directory and stopping does not always clear it, same as the harness found.
 */
async function restart(url) {
  try {
    docker(['stop', CONTAINER]);
  } catch {
    // already stopped
  }
  docker([
    'run',
    '--rm',
    '-v',
    'vttforge-e2e-data:/data',
    'alpine',
    'sh',
    '-lc',
    'rm -rf /data/Config/options.json.lock',
  ]);
  docker(['start', CONTAINER]);
  for (let i = 0; i < 90; i += 1) {
    try {
      await fetch(url, { redirect: 'manual' });
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
  throw new Error('Foundry did not answer after the restart');
}

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
}

const { baseUrl: url } = await start();
console.log('foundry at', url);
install();
await restart(url);
console.log('restarted so the package scan picks it up');

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
  console.log(logs(30));
  // Without this a throw before the first check leaves `results` empty, and
  // "0/0 checks passed" would exit 0. A run that died proved nothing.
  check('the run finished without throwing', false, err?.message ?? String(err));
} finally {
  await browser.close();
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exitCode = failed.length === 0 ? 0 : 1;
