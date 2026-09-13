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
      // `readme`, `changelog` e `license` no manifesto sao caminhos dentro da
      // pasta do modulo, entao os tres arquivos tem que entrar no zip. A lista
      // padrao do plugin nao os inclui, e nomear a lista substitui o padrao.
      // `docs` entra junto porque o README aponta para as imagens de la, e o
      // Foundry le esse README de dentro da pasta do modulo.
      staticAssets: ['lang', 'templates', 'packs', 'docs', 'README.md', 'CHANGELOG.md', 'LICENSE'],
    }),
  ],
});
