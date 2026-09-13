/**
 * Foundry runtime globals, typed from `@vttforge/types`.
 *
 * An ambient declaration, so it belongs in a `.d.ts` and is picked up by
 * `include` rather than imported.
 *
 * `var`, not `const`. Two `declare global` blocks naming the same global have
 * to merge, and only `var` merges. A `const` here collides with the identical
 * declaration `@vttforge/testing` ships, and `tsc` stops with TS2451.
 */
import type {
  FoundryConfig,
  FoundryConstants,
  FoundryNamespace,
  Game,
  HooksApi,
  UiApi,
} from '@vttforge/types';

declare global {
  var game: Game;
  var CONFIG: FoundryConfig;
  var CONST: FoundryConstants;
  var Hooks: HooksApi;
  var ui: UiApi;
  var foundry: FoundryNamespace;
}
