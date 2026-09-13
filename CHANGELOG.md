# Changelog

## 0.2.1

Documentation only. Nothing the module does changed.

The README that ships inside the package is the one people read: Foundry points
at it from the manifest. It now opens with how to install, shows both windows,
and drops the jargon from its headings. The macro example ran into an error
when pasted: it declared the same name twice.

## 0.2.0

First release.

### Settings vault

Export the settings a world holds and carry them to another world.

The export covers module settings, not core ones, and records where it came
from: the Foundry version, the system and the system version. Import reports
what it wrote and what it skipped. A setting whose package is not installed in
the target world is skipped with a reason, never thrown.

Foundry v14 has three setting scopes, not two. `client` lives in localStorage
and belongs to a device. `world` lives in the database and is the same for
everyone. `user` lives in the database and is keyed by user id, and a user id
does not survive a change of world. So `user` settings export by user name and
map by name on import, and every name that does not match is reported.

Nothing that looks like a credential is exported. The window says so before you
click.

### Module updates

See which installed modules have a newer release, and read the release notes
without leaving Foundry.

The check reads GitHub, at most once a day per module, and only when you ask.
Opening the window costs nothing: it shows the last result, and says "not
checked yet" until you press the button. The result is stored on the world, so
one check serves every user.

Only a Gamemaster can run it, because the result is written to a world setting.

A repository with no readable release reports that reason instead of a version.
The newest release of a monorepo can be tagged `@scope/name@0.6.0`, which is a
tag and not a version, and comparing it to a version produces an answer with no
meaning. A tag that does not start with a version is reported as unreadable.

The request budget is 40 per check. When it runs out the loop stops, and the
modules it did not reach say so instead of being cached as failures. A day of
"budget spent" on a module nobody checked is worse than no answer.

### Built on

Foundry v14. ApplicationV2 and DialogV2 only. Requires no other module.
