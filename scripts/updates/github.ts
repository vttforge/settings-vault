/**
 * Where a module's releases live, and what the newest one says.
 *
 * Only GitHub, and only because of what a browser is allowed to fetch. Three
 * candidates were measured:
 *
 * - `github.com/<o>/<r>/releases/latest/download/module.json` ends up on a
 *   redirect host that sends no `Access-Control-Allow-Origin`, so the browser
 *   drops the response.
 * - `foundryvtt.com/api/packages/<id>` answers 404.
 * - `api.github.com/repos/<o>/<r>/releases/latest` sends `*`, and its body
 *   carries the tag and the release notes together.
 *
 * The last one is the only one that works from inside a world, so it is the
 * only one used. A module hosted anywhere else is reported as unchecked, not
 * guessed at.
 */

/** An owner and a repository, the two halves of a GitHub API path. */
export interface Repo {
  readonly owner: string;
  readonly repo: string;
}

/** What the newest release says. */
export interface Release {
  /** The version in the tag, with any leading `v` removed. */
  readonly version: string;
  /** The release notes, as written. Markdown, and not rendered here. */
  readonly notes: string;
  /** The release page, for a GM who wants to read it in full. */
  readonly url: string;
  /** When it was published, ISO, or `null` when the release is a draft. */
  readonly publishedAt: string | null;
}

const HOSTS = new Set(['github.com', 'www.github.com', 'raw.githubusercontent.com']);

/**
 * The repository a URL points at, or `undefined`.
 *
 * Reads the `url` and `manifest` fields of a manifest. Both are optional and
 * either may point somewhere else, so both are tried and neither is assumed.
 */
export function repoFromUrl(value: string | undefined): Repo | undefined {
  if (!value) return undefined;
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return undefined;
  }
  if (parsed.hostname === 'api.github.com') {
    const [repos, owner, repo] = parsed.pathname.replace(/^\//, '').split('/');
    if (repos === 'repos' && owner && repo) return { owner, repo };
    return undefined;
  }
  if (!HOSTS.has(parsed.hostname)) return undefined;
  const [owner, repo] = parsed.pathname.replace(/^\//, '').split('/');
  if (!owner || !repo) return undefined;
  // A repository name can carry `.git` when the URL was copied from a clone.
  return { owner, repo: repo.replace(/\.git$/, '') };
}

/**
 * Looks like a version: two or three numbers, then anything.
 *
 * A tag is not a version. A monorepo tags its releases per package, and the
 * newest tag of one such repository reads `@scope/name@0.6.0`. Handing that to
 * a version comparison produces an answer with no meaning, and the window
 * would show it as the version to upgrade to. Better to say the tag cannot be
 * read than to invent a number.
 */
const VERSION = /^\d+\.\d+(?:\.\d+)?/;

/** The version inside a tag, or `undefined` when the tag does not hold one. */
function versionFromTag(tag: string): string | undefined {
  const stripped = tag.replace(/^v/i, '');
  return VERSION.test(stripped) ? stripped : undefined;
}

/**
 * The newest release of a repository.
 *
 * Rejects with a message worth showing a GM. The common ones are a repository
 * with no releases (404) and the hourly request budget running out (403).
 */
export async function latestRelease(repo: Repo): Promise<Release> {
  const url = `https://api.github.com/repos/${repo.owner}/${repo.repo}/releases/latest`;
  const response = await fetch(url, { headers: { accept: 'application/vnd.github+json' } });

  if (response.status === 404) {
    throw new Error('no published release');
  }
  if (response.status === 403 || response.status === 429) {
    const remaining = response.headers.get('x-ratelimit-remaining');
    throw new Error(
      remaining === '0'
        ? "GitHub's hourly request budget is spent. Try again later."
        : `GitHub refused the request (${response.status}).`,
    );
  }
  if (!response.ok) {
    throw new Error(`GitHub answered ${response.status}.`);
  }

  const body = (await response.json()) as {
    tag_name?: unknown;
    body?: unknown;
    html_url?: unknown;
    published_at?: unknown;
  };
  if (typeof body.tag_name !== 'string' || body.tag_name === '') {
    throw new Error('the release carries no tag');
  }
  const version = versionFromTag(body.tag_name);
  if (version === undefined) {
    throw new Error(`its newest release tag is not a version (${body.tag_name})`);
  }
  return {
    version,
    notes: typeof body.body === 'string' ? body.body : '',
    url: typeof body.html_url === 'string' ? body.html_url : '',
    publishedAt: typeof body.published_at === 'string' ? body.published_at : null,
  };
}
