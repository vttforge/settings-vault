export const MODULE_ID = 'settings-vault';

/** The file format version written into every export. */
export const PROFILE_FORMAT = 1;

/** Namespaces that belong to Foundry, not to a module. */
export const CORE_NAMESPACES = new Set(['core']);

/** The hidden world setting the last update check is kept in. */
export const CACHE_SETTING = 'updateCache';

/**
 * How long a cached release stays good. A day, because GitHub allows sixty
 * requests an hour to a browser with no token and a module list does not
 * change between two cups of coffee.
 */
export const TTL_MS = 24 * 60 * 60 * 1000;

/**
 * The most requests one check will make. Below sixty on purpose: a GM who
 * presses the button twice should not be told the budget is gone.
 */
export const MAX_REQUESTS = 40;
