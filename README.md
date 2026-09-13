# Settings Vault

[![CI](https://github.com/vttforge/settings-vault/actions/workflows/ci.yml/badge.svg)](https://github.com/vttforge/settings-vault/actions/workflows/ci.yml)
[![Foundry v14](https://img.shields.io/badge/Foundry-v14-informational)](https://foundryvtt.com/)
[![Licence MIT](https://img.shields.io/badge/licence-MIT-blue)](LICENSE)
[![Built with VTTForge](https://img.shields.io/badge/built%20with-VTTForge-8a2be2)](https://github.com/vttforge/vttforge)
[![Downloads](https://img.shields.io/github/downloads/vttforge/settings-vault/total)](https://github.com/vttforge/settings-vault/releases)

Write the module settings of a Foundry world to a file, read that file into
another world, and see which of your modules have a newer release.

Setting up thirty modules takes an evening. Starting a new world means doing it
again from memory. This module writes what you configured to a JSON file you
keep, and puts it back when you need it. It also tells you when one of those
thirty has shipped a new version, and what changed in it.

Foundry VTT v14 or later. GM only.

## What it does

Open **Settings → Configure Settings → Settings Vault**.

Tick the packages you want. Write a profile, and your browser saves a JSON file.
In another world, choose the file and read it back. The window then lists every
value it applied and every one it skipped, with the reason.

A profile is plain JSON. Open it, read it, delete a line, send it to someone.

## The three scopes

Foundry stores a setting in one of three places, and each travels differently.

**World.** Same value for everyone in the world, held in the database. It
travels, and only a GM can write it.

**Client.** Held in the browser, one value per device. It travels, and lands on
whichever device does the import.

**User.** Held in the database against one user. Foundry writes a user-scope
setting against whoever is logged in and gives no way to write another user's.
So a profile carries the values of the person who exported it, and the person
importing receives them as their own. You cannot move a player's settings for
them.

The window shows the count per scope for each package, so you know what a
profile will carry before you write it.

## Module updates

Open **Settings → Configure Settings → Check for updates**.

The list shows every installed module, the version this world runs, and the
newest release found. A module that is behind shows the new version, the release
notes, and a link to the release page. Nothing here installs anything: use
Foundry's own module installer for that.

Releases are read from GitHub. That is not a preference. A browser can only
fetch what a server allows it to, and of the three places a version could come
from, one sends no permission header, one answers 404, and `api.github.com`
answers with the tag and the notes together. A module hosted anywhere else is
listed as unchecked, with the reason.

### Why there is a button

GitHub allows a browser sixty requests an hour without a token, and a
conditional request that comes back "not modified" still spends one. Thirty
modules would burn half of that on every check.

So nothing checks on its own. A result is kept for a day, opening the window
costs nothing, and the button asks for a fresh one. If a check runs out of
budget it stops there and says how many modules it left out. It does not keep
asking and it does not record a refusal as though those modules had been
checked.

A personal access token would raise the ceiling. It would also mean this module
storing a credential, which is the thing the section below exists to keep out of
a file. So there is no token setting.

### Tags that are not versions

The newest release of a monorepo can be tagged `@scope/name@0.6.0`. That is a
tag, not a version, and comparing it to an installed version produces an answer
with no meaning. A tag that does not start with a version is reported as unreadable
rather than shown as the version to upgrade to.

## Credentials

Some modules keep an API token or a licence key in a setting. Values whose key
names one stay out of the file unless you tick the box. The check reads the key
name, so it catches the common cases and nothing clever.

Read a profile before you share it.

## What happens on import

Each value is applied on its own. A value that no longer fits its setting is
skipped, and so is a setting whose package is not installed in the target world.
Both are normal when a profile is older than the world it lands in. The rest of
the import continues, and the report names what was left out.

Export the target world first if you want a way back.

## From a macro

```js
const vault = game.modules.get('settings-vault').api;

// Read the world. Writes nothing.
const profile = vault.buildProfile({ namespaces: ['some-module'] });

// Write it back, and see what did not land.
const report = await vault.applyProfile(profile);
console.log(report.applied.length, report.skipped);

// Open the profile window.
vault.open();

// What the last update check found. Asks GitHub nothing.
const report = vault.lastReport();
console.log(report.outdatedCount, report.checkedAt);

// Ask GitHub. One request per module with a release page. GM only, because
// the result is stored in the world.
await vault.checkUpdates({ force: true });

// Open the updates window.
vault.openUpdates();
```

## Install

Paste this manifest URL into Foundry's module installer:

```
https://github.com/vttforge/settings-vault/releases/latest/download/module.json
```

## Build from source

```bash
pnpm install
pnpm run typecheck
pnpm run lint
pnpm run build
```

`pnpm run build` writes `dist/` and a release zip with the manifest at the root.

## Running it in a real Foundry

```bash
pnpm run build
set -a && . .env && set +a
pnpm run e2e
```

It boots a Foundry v14 container, launches a world on a minimal test system
under `e2e/fixtures/system`, installs the built module, joins as the Gamemaster
and drives the module's own API. It reads the live settings registry, changes a
value and applies a profile over it, runs one real check against GitHub, seeds a
higher version to draw the outdated row, and confirms both refusals: a player
cannot check, and a spent request budget stops the loop instead of caching a
refusal against every remaining module. It opens both windows and asserts the
console stayed clean. 26 checks.

Local only. Booting Foundry needs a licence and an account, so this cannot run
in CI on a fresh clone. It needs `docker` on the PATH, plus
`FOUNDRY_LICENSE_KEY`, `FOUNDRY_USERNAME` and `FOUNDRY_PASSWORD` in the
environment, and `FOUNDRY_ACCEPT_LICENSE=1` to say you accept Foundry's licence
agreement. The container comes from `@vttforge/testing/container`.

The first run downloads Foundry and takes a couple of minutes. Later runs reuse
the data volume. `KEEP_FOUNDRY=1` leaves the container up for poking at.

Built with the [VTTForge SDK](https://github.com/vttforge/vttforge).

## Licence

MIT. See [LICENSE](LICENSE).

Release notes are in [CHANGELOG.md](CHANGELOG.md).
