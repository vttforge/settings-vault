/**
 * Foundry runtime globals, typed from `@vttforge/types`.
 *
 * An ambient declaration, so it belongs in a `.d.ts` and is picked up by
 * `include` rather than imported.
 *
 * `var`, not `const`. Two `declare global` blocks naming the same global have
 * to merge, and only `var` merges. A `const` here collides with the identical
 * declaration `@vttforge/testing` ships, and `tsc` stops with TS2451.
 *
 * `@vttforge/types` covers `game`, `ui`, `CONFIG`, `CONST` and the hook map. It
 * does not yet describe the `foundry.*` namespace, so the two members this
 * module reaches for are narrowed below rather than left as `any`.
 */
import type {
  FoundryConfig,
  FoundryConstants,
  FoundryUtils,
  Game,
  HooksApi,
  UiApi,
} from '@vttforge/types';

interface FoundryNamespace {
  readonly applications: {
    readonly api: {
      readonly DialogV2: {
        confirm(options: Record<string, unknown>): Promise<boolean>;
      };
    };
  };
  /**
   * `FoundryUtils` covers what the docs describe. The two file helpers are not
   * in it, so they are added here rather than replacing the whole type with a
   * hand-written one.
   */
  readonly utils: FoundryUtils & {
    saveDataToFile(data: string, type: string, filename: string): void;
    readTextFromFile(file: File): Promise<string>;
  };
}

declare global {
  var game: Game;
  var CONFIG: FoundryConfig;
  var CONST: FoundryConstants;
  var Hooks: HooksApi;
  var ui: UiApi;
  var foundry: FoundryNamespace;
}
