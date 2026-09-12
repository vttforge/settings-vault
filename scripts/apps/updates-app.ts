/**
 * The updates window.
 *
 * One list: every installed module, the version in this world, the newest
 * release found, and the notes that came with it. A module hosted outside
 * GitHub says so rather than showing nothing.
 *
 * Opening the window costs no request. It reads what the last check left
 * behind, and a button asks for a fresh one. That is not a convenience: a
 * browser gets sixty GitHub requests an hour without a token, so a window that
 * checked on every open would spend the budget on being looked at.
 */
import { BaseHandlebarsApplication } from '@vttforge/core';
import { MODULE_ID } from '../constants.js';
import { checkUpdates, lastReport, type UpdateReport } from '../updates/check.js';

export class UpdatesApp extends BaseHandlebarsApplication() {
  static DEFAULT_OPTIONS = {
    id: 'settings-vault-updates',
    classes: ['settings-vault'],
    window: {
      title: 'SETTINGS_VAULT.Updates.title',
      icon: 'fa-solid fa-arrows-rotate',
      resizable: true,
    },
    position: { width: 620, height: 'auto' },
    actions: {
      refresh: UpdatesApp.onRefresh,
    },
  };

  static PARTS = {
    body: { template: `modules/${MODULE_ID}/templates/updates.hbs` },
  };

  /** Replaced by a check. Until then, whatever the last one stored. */
  #report: UpdateReport | undefined;

  /** True while a check is in flight, so the button cannot be pressed twice. */
  #checking = false;

  override async _prepareContext(): Promise<Record<string, unknown>> {
    const report = this.#report ?? lastReport();
    return {
      rows: report.rows,
      hasRows: report.rows.length > 0,
      outdatedCount: report.outdatedCount,
      skippedForBudget: report.skippedForBudget,
      checkedAt: report.checkedAt === null ? null : formatWhen(report.checkedAt),
      checking: this.#checking,
    };
  }

  static async onRefresh(this: UpdatesApp): Promise<void> {
    if (this.#checking) return;
    this.#checking = true;
    await this.render();
    try {
      this.#report = await checkUpdates({ force: true });
    } catch (error) {
      ui.notifications?.error(
        game.i18n.format('SETTINGS_VAULT.Updates.failed', {
          reason: error instanceof Error ? error.message : String(error),
        }),
      );
    } finally {
      this.#checking = false;
      await this.render();
    }
  }
}

/** A date a GM can read, in their own locale. */
function formatWhen(iso: string): string {
  const at = new Date(iso);
  return Number.isNaN(at.getTime()) ? iso : at.toLocaleString();
}
