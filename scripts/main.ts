/**
 * Settings Vault — entry point.
 *
 * The module registers one settings menu and nothing else. It owns no document
 * type, draws nothing on the canvas, and stores no state of its own: a profile
 * lives in a file the GM keeps.
 */
import { registerModule } from '@vttforge/core';
import { VaultApp } from './apps/vault-app.js';
import { MODULE_ID } from './constants.js';
import {
  applyProfile,
  buildProfile,
  type ExportOptions,
  type ImportReport,
  type Profile,
} from './profile.js';

/** What `game.modules.get("settings-vault").api` offers macros and other modules. */
interface ModuleApi {
  /** Read the world and return a profile. Writes nothing. */
  buildProfile(options?: ExportOptions): Profile;
  /** Write a profile back, one key at a time, and report what did not land. */
  applyProfile(profile: Profile): Promise<ImportReport>;
  open(): void;
}

const api: ModuleApi = {
  buildProfile,
  applyProfile,
  open: () => {
    new VaultApp().render({ force: true });
  },
};

registerModule({
  id: MODULE_ID,

  onBeforeInit: () => {
    const handle = game.modules.get(MODULE_ID);
    if (handle) handle.api = api;
  },

  onAfterInit: () => {
    // A button rather than a row: the work needs a screen, and world-scope
    // settings are a GM's to write.
    game.settings.registerMenu(MODULE_ID, 'vault', {
      name: 'SETTINGS_VAULT.Menu.name',
      label: 'SETTINGS_VAULT.Menu.label',
      hint: 'SETTINGS_VAULT.Menu.hint',
      icon: 'fa-solid fa-box-archive',
      type: VaultApp,
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
  },
});
