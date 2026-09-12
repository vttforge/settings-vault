# Settings Vault

Write the module settings of a Foundry world to a file, and read that file into
another world.

Setting up thirty modules takes an evening. Starting a new world means doing it
again from memory. This module writes what you configured to a JSON file you
keep, and puts it back when you need it.

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

// Open the window.
vault.open();
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

Built with the [VTTForge SDK](https://github.com/vttforge/vttforge).

## Licence

MIT.
