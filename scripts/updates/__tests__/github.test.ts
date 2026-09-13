/**
 * Reading a repository out of a manifest, and a version out of a release.
 *
 * Nothing here touches Foundry. `repoFromUrl` runs on two manifest fields that
 * a module author fills in by hand, and `latestRelease` reads an answer from a
 * server that has every right to refuse.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { latestRelease, RateLimitError, repoFromUrl } from '../github.js';

const realFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = realFetch;
  vi.restoreAllMocks();
});

/** One canned answer, with the headers a rate limit is told apart by. */
function answers(
  status: number,
  body: unknown = {},
  headers: Record<string, string> = {},
): typeof globalThis.fetch {
  return vi.fn(
    async () =>
      new Response(typeof body === 'string' ? body : JSON.stringify(body), {
        status,
        headers,
      }),
  ) as unknown as typeof globalThis.fetch;
}

describe('repoFromUrl', () => {
  it('reads the owner and the repository', () => {
    expect(repoFromUrl('https://github.com/vttforge/settings-vault')).toEqual({
      owner: 'vttforge',
      repo: 'settings-vault',
    });
  });

  it('reads a release download URL, which is what `manifest` holds', () => {
    expect(
      repoFromUrl(
        'https://github.com/vttforge/settings-vault/releases/latest/download/module.json',
      ),
    ).toEqual({ owner: 'vttforge', repo: 'settings-vault' });
  });

  it('drops the `.git` a clone URL carries', () => {
    expect(repoFromUrl('https://github.com/owner/thing.git')).toEqual({
      owner: 'owner',
      repo: 'thing',
    });
  });

  it('takes the API host, where the path is one segment longer', () => {
    expect(repoFromUrl('https://api.github.com/repos/owner/thing')).toEqual({
      owner: 'owner',
      repo: 'thing',
    });
    expect(repoFromUrl('https://api.github.com/users/owner')).toBeUndefined();
  });

  it('says nothing rather than guessing', () => {
    // A module hosted elsewhere is reported as unchecked. Guessing an owner
    // and a repository out of these would check the wrong repository.
    expect(repoFromUrl(undefined)).toBeUndefined();
    expect(repoFromUrl('')).toBeUndefined();
    expect(repoFromUrl('not a url')).toBeUndefined();
    expect(repoFromUrl('https://gitlab.com/owner/thing')).toBeUndefined();
    expect(repoFromUrl('https://github.com/owner')).toBeUndefined();
  });
});

describe('latestRelease', () => {
  const repo = { owner: 'owner', repo: 'thing' };

  it('reads the version, the notes and the page', async () => {
    globalThis.fetch = answers(200, {
      tag_name: 'v1.2.3',
      body: 'Fixes a crash.',
      html_url: 'https://github.com/owner/thing/releases/tag/v1.2.3',
      published_at: '2026-01-02T03:04:05Z',
    });

    await expect(latestRelease(repo)).resolves.toEqual({
      version: '1.2.3',
      notes: 'Fixes a crash.',
      url: 'https://github.com/owner/thing/releases/tag/v1.2.3',
      publishedAt: '2026-01-02T03:04:05Z',
    });
  });

  it('refuses a tag that is not a version', async () => {
    // A monorepo tags per package. Comparing `@scope/name@0.6.0` to an
    // installed version produces an answer with no meaning.
    globalThis.fetch = answers(200, { tag_name: '@scope/name@0.6.0' });
    await expect(latestRelease(repo)).rejects.toThrow(/not a version/);
  });

  it('says a repository has no release, rather than failing obscurely', async () => {
    globalThis.fetch = answers(404);
    await expect(latestRelease(repo)).rejects.toThrow('no published release');
  });

  it('tells a spent budget apart from any other refusal', async () => {
    // A 403 is the budget only when the header says so. The caller stops on
    // one and carries on past the other, so the two may not be lumped together.
    globalThis.fetch = answers(403, {}, { 'x-ratelimit-remaining': '0' });
    await expect(latestRelease(repo)).rejects.toBeInstanceOf(RateLimitError);

    globalThis.fetch = answers(403, {}, { 'x-ratelimit-remaining': '57' });
    const other = await latestRelease(repo).catch((error: unknown) => error);
    expect(other).toBeInstanceOf(Error);
    expect(other).not.toBeInstanceOf(RateLimitError);

    // A 429 is always the budget, header or no header.
    globalThis.fetch = answers(429);
    await expect(latestRelease(repo)).rejects.toBeInstanceOf(RateLimitError);
  });

  it('fills in what a release leaves out', async () => {
    globalThis.fetch = answers(200, { tag_name: '2.0' });
    await expect(latestRelease(repo)).resolves.toEqual({
      version: '2.0',
      notes: '',
      url: '',
      publishedAt: null,
    });
  });
});
