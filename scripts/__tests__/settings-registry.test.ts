/**
 * Reading the world's settings registry.
 *
 * The registry is the only way to reach a setting belonging to a package this
 * module knows nothing about, which is the whole job. The mock fills it the
 * way Foundry does, so these run against the same map the module reads in a
 * world.
 */
import { withMockFoundry } from '@vttforge/testing/vitest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { listNamespaces, listSettings, readValue, writeValue } from '../settings-registry.js';

let mock: ReturnType<typeof withMockFoundry> | undefined;

beforeEach(() => {
  mock = withMockFoundry();
});

afterEach(() => {
  mock?.restore();
  mock = undefined;
});

/** Register one setting, the way a package does during `init`. */
function register(
  namespace: string,
  key: string,
  config: Partial<{ scope: 'world' | 'client' | 'user'; config: boolean; name: string }> = {},
): void {
  game.settings.register(namespace, key, {
    scope: config.scope ?? 'world',
    config: config.config ?? false,
    type: String,
    default: `${namespace}.${key}`,
    ...(config.name === undefined ? {} : { name: config.name }),
  });
}

describe('listSettings', () => {
  it('narrows each entry to what the vault needs', () => {
    register('some-module', 'theme', { scope: 'client', config: true, name: 'Theme' });

    expect(listSettings()).toEqual([
      {
        id: 'some-module.theme',
        namespace: 'some-module',
        key: 'theme',
        scope: 'client',
        name: 'Theme',
        config: true,
      },
    ]);
  });

  it('leaves core out', () => {
    // Core's settings describe the world, not a package. Carrying them would
    // overwrite things like the active system or the permission table.
    register('core', 'moduleConfiguration');
    register('some-module', 'theme');

    expect(listSettings().map((s) => s.id)).toEqual(['some-module.theme']);
  });

  it('keeps registration order', () => {
    register('b-module', 'one');
    register('a-module', 'two');

    expect(listSettings().map((s) => s.id)).toEqual(['b-module.one', 'a-module.two']);
  });
});

describe('listNamespaces', () => {
  it('names each package once, sorted', () => {
    register('b-module', 'one');
    register('b-module', 'two');
    register('a-module', 'three');
    register('core', 'four');

    expect(listNamespaces()).toEqual(['a-module', 'b-module']);
  });
});

describe('readValue', () => {
  it('reads the current value', () => {
    register('some-module', 'theme');
    const [setting] = listSettings();

    expect(readValue(setting)).toBe('some-module.theme');
  });

  it('hands back undefined when a package throws from its own getter', () => {
    // One broken setting must not stop a whole export.
    register('some-module', 'theme');
    const [setting] = listSettings();
    const read = game.settings.get;
    game.settings.get = () => {
      throw new Error('this package is having a bad day');
    };

    try {
      expect(readValue(setting)).toBeUndefined();
    } finally {
      // `restore()` replaces the whole `game` object, so this would go with it
      // anyway. Put it back here so the patch cannot outlive the test it is
      // written for.
      game.settings.get = read;
    }
  });
});

describe('writeValue', () => {
  it('writes through Foundry, so its validation runs', async () => {
    register('some-module', 'theme');
    const [setting] = listSettings();

    await writeValue(setting, 'dark');
    expect(game.settings.get('some-module', 'theme')).toBe('dark');
  });
});
