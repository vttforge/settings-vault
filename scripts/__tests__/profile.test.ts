/**
 * Writing a profile and reading one back.
 *
 * The two halves a GM depends on. An export that carries a password, or an
 * import that stops on the first key it cannot write, are both worse than
 * useless, so both are pinned here.
 */
import { withMockFoundry } from '@vttforge/testing/vitest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PROFILE_FORMAT } from '../constants.js';
import { applyProfile, buildProfile, isProfile, looksSecret } from '../profile.js';

let mock: ReturnType<typeof withMockFoundry> | undefined;

beforeEach(() => {
  mock = withMockFoundry({
    game: { system: { id: 'some-system', version: '2.1.0' }, version: '14' },
  });
});

afterEach(() => {
  mock?.restore();
  mock = undefined;
});

function register(
  namespace: string,
  key: string,
  value: unknown,
  scope: 'world' | 'client' | 'user' = 'world',
): void {
  game.settings.register(namespace, key, { scope, config: true, type: String, default: value });
}

describe('buildProfile', () => {
  it('carries every setting, with its scope', () => {
    register('a-module', 'theme', 'dark', 'client');
    register('b-module', 'difficulty', 'hard');

    const profile = buildProfile({ label: 'my table' });
    expect(profile.format).toBe(PROFILE_FORMAT);
    expect(profile.label).toBe('my table');
    expect(profile.entries).toEqual([
      { id: 'a-module.theme', scope: 'client', value: 'dark' },
      { id: 'b-module.difficulty', scope: 'world', value: 'hard' },
    ]);
  });

  it('records the world it came from', () => {
    register('a-module', 'theme', 'dark');
    const profile = buildProfile();

    expect(profile.foundry).toBe('14');
    expect(profile.system).toEqual({ id: 'some-system', version: '2.1.0' });
  });

  it('takes only the namespaces asked for', () => {
    register('a-module', 'theme', 'dark');
    register('b-module', 'difficulty', 'hard');

    expect(buildProfile({ namespaces: ['b-module'] }).entries.map((e) => e.id)).toEqual([
      'b-module.difficulty',
    ]);
  });

  it('leaves a value that names a credential out of the file', () => {
    // An export is a file a GM might paste into a chat window.
    register('a-module', 'apiToken', 'sk-live-0001');
    register('a-module', 'licenceKey', 'AAAA-BBBB');
    register('a-module', 'theme', 'dark');

    expect(buildProfile().entries.map((e) => e.id)).toEqual(['a-module.theme']);
  });

  it('carries them when asked, because some are meant to travel', () => {
    register('a-module', 'apiToken', 'sk-live-0001');

    expect(buildProfile({ includeSecrets: true }).entries.map((e) => e.id)).toEqual([
      'a-module.apiToken',
    ]);
  });
});

describe('looksSecret', () => {
  it('reads the key name, and nothing cleverer', () => {
    const setting = (key: string) => ({
      id: `m.${key}`,
      namespace: 'm',
      key,
      scope: 'world' as const,
      name: undefined,
      config: true,
    });

    for (const key of ['apiKey', 'accessToken', 'password', 'licenseKey', 'licenceKey']) {
      expect(looksSecret(setting(key))).toBe(true);
    }
    for (const key of ['theme', 'difficulty', 'showTutorial']) {
      expect(looksSecret(setting(key))).toBe(false);
    }
  });
});

describe('isProfile', () => {
  it('takes a profile this version can read, and nothing else', () => {
    expect(isProfile({ format: PROFILE_FORMAT, entries: [] })).toBe(true);
    expect(isProfile({ format: PROFILE_FORMAT + 1, entries: [] })).toBe(false);
    expect(isProfile({ format: PROFILE_FORMAT })).toBe(false);
    expect(isProfile(null)).toBe(false);
    expect(isProfile('a string')).toBe(false);
  });
});

describe('applyProfile', () => {
  const profile = (entries: { id: string; scope: 'world' | 'client'; value: unknown }[]) => ({
    format: PROFILE_FORMAT,
    createdAt: '2026-01-01T00:00:00.000Z',
    label: '',
    foundry: '14',
    system: { id: 'some-system', version: '2.1.0' },
    entries,
  });

  it('writes each value and names what it wrote', async () => {
    register('a-module', 'theme', 'light');
    register('b-module', 'difficulty', 'easy');

    const report = await applyProfile(
      profile([
        { id: 'a-module.theme', scope: 'world', value: 'dark' },
        { id: 'b-module.difficulty', scope: 'world', value: 'hard' },
      ]),
    );

    expect(report.applied).toEqual(['a-module.theme', 'b-module.difficulty']);
    expect(report.skipped).toEqual([]);
    expect(game.settings.get('a-module', 'theme')).toBe('dark');
  });

  it('skips a setting whose package is not installed here', async () => {
    const report = await applyProfile(profile([{ id: 'gone.key', scope: 'world', value: 1 }]));

    expect(report.applied).toEqual([]);
    expect(report.skipped).toEqual([{ id: 'gone.key', reason: 'not registered in this world' }]);
  });

  it('skips a setting that changed scope, rather than writing it somewhere else', async () => {
    register('a-module', 'theme', 'light', 'client');

    const report = await applyProfile(
      profile([{ id: 'a-module.theme', scope: 'world', value: 'dark' }]),
    );

    expect(report.applied).toEqual([]);
    expect(report.skipped).toEqual([{ id: 'a-module.theme', reason: 'scope changed to client' }]);
    expect(game.settings.get('a-module', 'theme')).toBe('light');
  });

  it('carries on past a value the setting refuses', async () => {
    // A profile older than the world is the ordinary case. An import that
    // stopped on the first bad key would be useless as a restore.
    register('a-module', 'theme', 'light');
    register('b-module', 'difficulty', 'easy');
    const write = game.settings.set;
    game.settings.set = (async (namespace: string, key: string, value: unknown) => {
      if (key === 'theme') throw new Error('this is not a theme');
      return write(namespace, key, value);
    }) as typeof game.settings.set;

    const report = await applyProfile(
      profile([
        { id: 'a-module.theme', scope: 'world', value: 42 },
        { id: 'b-module.difficulty', scope: 'world', value: 'hard' },
      ]),
    );

    expect(report.applied).toEqual(['b-module.difficulty']);
    expect(report.skipped).toEqual([{ id: 'a-module.theme', reason: 'this is not a theme' }]);
    expect(game.settings.get('b-module', 'difficulty')).toBe('hard');
  });
});
