// biome-ignore-all lint/complexity/noThisInStatic: ApplicationV2 calls an
// action handler with `this` bound to the instance, so a handler declared
// static still reads instance state. Following the rule's fix here and
// writing `VaultApp.#selected()` would compile and then fail at runtime.
/**
 * The vault window.
 *
 * One screen: pick which packages to carry, write a file, or read one back and
 * see what landed. The report matters as much as the import. A GM restoring a
 * profile needs to know which keys did not make it and why, and a silent
 * success would hide exactly the cases worth knowing about.
 *
 * Built on `BaseApplication` rather than a Handlebars base. The SDK ships the
 * Handlebars mixin only for actor and item sheets, so a standalone templated
 * window renders its one template here and hands the element back.
 */
import { BaseApplication } from '@vttforge/core';
import { MODULE_ID } from '../constants.js';
import {
  applyProfile,
  buildProfile,
  type ImportReport,
  isProfile,
  looksSecret,
  type Profile,
} from '../profile.js';
import { listSettings } from '../settings-registry.js';

interface NamespaceRow {
  readonly id: string;
  readonly title: string;
  readonly total: number;
  readonly secrets: number;
  readonly world: number;
  readonly client: number;
  readonly user: number;
}

/** Group the registered settings by package, for the checkbox list. */
function namespaceRows(): NamespaceRow[] {
  const counts = new Map<
    string,
    { total: number; secrets: number; world: number; client: number; user: number }
  >();
  for (const setting of listSettings()) {
    const row = counts.get(setting.namespace) ?? {
      total: 0,
      secrets: 0,
      world: 0,
      client: 0,
      user: 0,
    };
    row.total += 1;
    if (looksSecret(setting)) row.secrets += 1;
    row[setting.scope] += 1;
    counts.set(setting.namespace, row);
  }
  return [...counts.entries()]
    .map(([id, row]) => ({ id, title: game.modules.get(id)?.title ?? id, ...row }))
    .sort((a, b) => a.title.localeCompare(b.title));
}

export class VaultApp extends BaseApplication() {
  static DEFAULT_OPTIONS = {
    id: 'settings-vault',
    classes: ['settings-vault'],
    window: {
      title: 'SETTINGS_VAULT.App.title',
      icon: 'fa-solid fa-box-archive',
      resizable: true,
    },
    position: { width: 560, height: 'auto' },
    actions: {
      exportProfile: VaultApp.onExport,
      importProfile: VaultApp.onImport,
      selectAll: VaultApp.onSelectAll,
      selectNone: VaultApp.onSelectNone,
    },
  };

  /** The last import's outcome, shown until the next one. */
  #report: ImportReport | undefined;

  async _renderHTML(): Promise<HTMLElement> {
    const rows = namespaceRows();
    const html = await foundry.applications.handlebars.renderTemplate(
      `modules/${MODULE_ID}/templates/vault.hbs`,
      {
        rows,
        hasRows: rows.length > 0,
        secretCount: rows.reduce((n, r) => n + r.secrets, 0),
        report: this.#report,
      },
    );
    const wrapper = document.createElement('div');
    wrapper.innerHTML = html;
    return wrapper;
  }

  /** The window root. Reading it before a render is a programming error. */
  get #root(): HTMLElement {
    const el = this.element;
    if (!el) throw new Error('The vault window is not rendered.');
    return el;
  }

  /** The packages ticked in the list. */
  #selected(): string[] {
    const boxes = this.#root.querySelectorAll('input[name="namespace"]:checked');
    return [...boxes].map((box) => (box as HTMLInputElement).value);
  }

  #field(name: string): HTMLInputElement | null {
    return this.#root.querySelector(`input[name="${name}"]`);
  }

  #setAll(checked: boolean): void {
    for (const box of this.#root.querySelectorAll('input[name="namespace"]')) {
      (box as HTMLInputElement).checked = checked;
    }
  }

  static async onExport(this: VaultApp): Promise<void> {
    const namespaces = this.#selected();
    if (namespaces.length === 0) {
      ui.notifications?.warn(game.i18n.localize('SETTINGS_VAULT.Notify.nothingPicked'));
      return;
    }
    const profile = buildProfile({
      namespaces,
      includeSecrets: this.#field('includeSecrets')?.checked ?? false,
      label: this.#field('label')?.value ?? '',
    });
    const stamp = new Date().toISOString().slice(0, 10);
    foundry.utils.saveDataToFile(
      JSON.stringify(profile, null, 2),
      'application/json',
      `settings-vault-${stamp}.json`,
    );
    ui.notifications?.info(
      game.i18n.localize('SETTINGS_VAULT.Notify.exported', { count: profile.entries.length }),
    );
  }

  static async onImport(this: VaultApp): Promise<void> {
    const file = this.#field('profileFile')?.files?.[0];
    if (!file) {
      ui.notifications?.warn(game.i18n.localize('SETTINGS_VAULT.Notify.noFile'));
      return;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(await foundry.utils.readTextFromFile(file));
    } catch {
      ui.notifications?.error(game.i18n.localize('SETTINGS_VAULT.Notify.unreadable'));
      return;
    }
    if (!isProfile(parsed)) {
      ui.notifications?.error(game.i18n.localize('SETTINGS_VAULT.Notify.wrongFormat'));
      return;
    }
    const profile: Profile = parsed;

    const go = await foundry.applications.api.DialogV2.confirm({
      window: { title: game.i18n.localize('SETTINGS_VAULT.Confirm.title') },
      content: `<p>${game.i18n.localize('SETTINGS_VAULT.Confirm.body', {
        count: profile.entries.length,
      })}</p>`,
    });
    if (!go) return;

    this.#report = await applyProfile(profile);
    await this.render();
  }

  static async onSelectAll(this: VaultApp): Promise<void> {
    this.#setAll(true);
  }

  static async onSelectNone(this: VaultApp): Promise<void> {
    this.#setAll(false);
  }
}
