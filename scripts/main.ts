/**
 * Settings Vault — entry point.
 *
 * Two settings menus and nothing else. The module owns no document type and
 * draws nothing on the canvas. A profile lives in a file the GM keeps; the only
 * thing stored in the world is the last update check, so that opening the
 * window costs no request.
 */
import { registerModule } from '@vttforge/core';
import { UpdatesApp } from './apps/updates-app.js';
import { VaultApp } from './apps/vault-app.js';
import { CACHE_SETTING, MODULE_ID } from './constants.js';
import {
  applyProfile,
  buildProfile,
  type ExportOptions,
  type ImportReport,
  type Profile,
} from './profile.js';
import { checkUpdates, EMPTY_CACHE, lastReport, type UpdateReport } from './updates/check.js';

/** What `game.modules.get("settings-vault").api` offers macros and other modules. */
interface ModuleApi {
  /** Read the world and return a profile. Writes nothing. */
  buildProfile(options?: ExportOptions): Profile;
  /** Write a profile back, one key at a time, and report what did not land. */
  applyProfile(profile: Profile): Promise<ImportReport>;
  /** What the last check found. Asks GitHub nothing. */
  lastReport(): UpdateReport;
  /** Ask GitHub about every module with a release page. Costs one request each. */
  checkUpdates(options?: { force?: boolean }): Promise<UpdateReport>;
  open(): void;
  openUpdates(): void;
}

const api: ModuleApi = {
  buildProfile,
  applyProfile,
  lastReport,
  checkUpdates,
  open: () => {
    new VaultApp().render({ force: true });
  },
  openUpdates: () => {
    new UpdatesApp().render({ force: true });
  },
};

registerModule({
  id: MODULE_ID,

  onBeforeInit: () => {
    const handle = game.modules.get(MODULE_ID);
    if (handle) handle.api = api;
  },

  onAfterInit: () => {
    // Hidden, because the window owns it. It holds the last check so that
    // opening the window spends no part of GitHub's hourly budget.
    game.settings.register(MODULE_ID, CACHE_SETTING, {
      scope: 'world',
      config: false,
      type: Object,
      default: EMPTY_CACHE,
    });

    // Buttons rather than rows: both need a screen, and world-scope settings
    // are a GM's to write.
    game.settings.registerMenu(MODULE_ID, 'vault', {
      name: 'SETTINGS_VAULT.Menu.name',
      label: 'SETTINGS_VAULT.Menu.label',
      hint: 'SETTINGS_VAULT.Menu.hint',
      icon: 'fa-solid fa-box-archive',
      type: VaultApp,
      restricted: true,
    });

    game.settings.registerMenu(MODULE_ID, 'updates', {
      name: 'SETTINGS_VAULT.UpdatesMenu.name',
      label: 'SETTINGS_VAULT.UpdatesMenu.label',
      hint: 'SETTINGS_VAULT.UpdatesMenu.hint',
      icon: 'fa-solid fa-arrows-rotate',
      type: UpdatesApp,
      restricted: true,
    });
  },

  onSetup: () => {
    game.keybindings.register(MODULE_ID, 'open', {
      name: 'SETTINGS_VAULT.Keybinding.open.name',
      hint: 'SETTINGS_VAULT.Keybinding.open.hint',
      editable: [],
      onDown: () => {
        api.open();
      },
      restricted: true,
    });

    game.keybindings.register(MODULE_ID, 'updates', {
      name: 'SETTINGS_VAULT.Keybinding.updates.name',
      hint: 'SETTINGS_VAULT.Keybinding.updates.hint',
      editable: [],
      onDown: () => {
        api.openUpdates();
      },
      restricted: true,
    });
  },
});
