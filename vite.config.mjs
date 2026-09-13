import vttforge from '@vttforge/vite-plugin';
import { defineConfig } from 'vite';

/**
 * Vite config for Settings Vault.
 *
 * `@vttforge/vite-plugin` owns the build contract for both systems and
 * modules — `kind: 'module'` tells the plugin to write `dist/module.json`
 * (instead of `system.json`) and to base chunk URLs at `/modules/settings-vault/`.
 */
export default defineConfig({
  plugins: [
    vttforge({
      id: 'settings-vault',
      kind: 'module',
      entry: 'scripts/main.ts',
      // `readme`, `changelog` and `license` in the manifest are paths inside the
      // module folder, so all three files have to be in the zip. The plugin's
      // default list leaves them out, and naming the list replaces the default.
      // `docs` goes in with them: the README points at the images there, and
      // Foundry reads that README from inside the module folder.
      staticAssets: ['lang', 'templates', 'packs', 'docs', 'README.md', 'CHANGELOG.md', 'LICENSE'],
    }),
  ],
});
