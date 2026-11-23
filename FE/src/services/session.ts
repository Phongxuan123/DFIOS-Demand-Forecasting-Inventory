/**
 * Session + client-cache plumbing shared by apiClient and AuthContext.
 * No imports on purpose: everything else may depend on this file.
 *
 * R-25: every per-account cache must disappear on login AND logout.
 *  - module-level caches register themselves with `registerCacheClearer`
 *  - every `dfios_*` key in sessionStorage / localStorage is removed,
 *    except the device preferences listed in PRESERVED_KEYS.
 * So: name any new storage key `dfios_<something>` and it is cleaned for free.
 */
const TOKEN_KEY = 'access_token';
const USER_KEY = 'user';
/** demo.md §6.3: refresh token, exchanged at POST /auth/refresh when the access token is rejected (401). */
const REFRESH_KEY = 'refresh_token';

/** Device-level preferences: not account data, survive login/logout. */
const PRESERVED_KEYS = new Set([
  'dfios_language',
  'dfios_theme',
  'dfios_sidebar_collapsed',
  'dfios_remember_me',
  'dfios_remembered_email',
  'dfios_notification_prefs', // R5F-08: per-account entries inside (utils/notifyPrefs.ts)
]);

export const AUTH_UNAUTHORIZED_EVENT = 'dfios:unauthorized';
export const AUTH_FORBIDDEN_EVENT = 'dfios:forbidden';

export interface ForbiddenEventDetail {
  message: string;
  url?: string;
  method?: string;
}

export function getToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function getStoredUser<T>(): T | null {
  try {
    const raw = localStorage.getItem(USER_KEY);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

export function storeSession(token: string, user: unknown, refreshToken?: string | null): void {
  try {
    localStorage.setItem(TOKEN_KEY, token);
    localStorage.setItem(USER_KEY, JSON.stringify(user));
    if (refreshToken) localStorage.setItem(REFRESH_KEY, refreshToken);
  } catch {
    /* storage blocked: session lives in memory for this tab only */
  }
}

export function getRefreshToken(): string | null {
  try {
    return localStorage.getItem(REFRESH_KEY);
  } catch {
    return null;
  }
}

/** New access + refresh token after POST /auth/refresh; the stored user is kept. */
export function storeTokens(token: string, refreshToken?: string | null): void {
  try {
    localStorage.setItem(TOKEN_KEY, token);
    if (refreshToken) localStorage.setItem(REFRESH_KEY, refreshToken);
  } catch {
    /* ignore */
  }
}

export function storeUser(user: unknown): void {
  try {
    localStorage.setItem(USER_KEY, JSON.stringify(user));
  } catch {
    /* ignore */
  }
}

export function clearSession(): void {
  try {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    localStorage.removeItem(REFRESH_KEY);
  } catch {
    /* ignore */
  }
}

const cacheClearers = new Set<() => void>();

/** Register an in-memory cache so it is wiped on login/logout. Returns an unregister function. */
export function registerCacheClearer(clear: () => void): () => void {
  cacheClearers.add(clear);
  return () => cacheClearers.delete(clear);
}

function purgeStorage(storage: Storage): void {
  const doomed: string[] = [];
  for (let i = 0; i < storage.length; i += 1) {
    const key = storage.key(i);
    if (key && key.startsWith('dfios_') && !PRESERVED_KEYS.has(key)) doomed.push(key);
  }
  doomed.forEach((key) => storage.removeItem(key));
}

/** Wipes every per-account client cache. Called on login, logout and forced sign-out (401). */
export function clearClientCaches(): void {
  cacheClearers.forEach((clear) => {
    try {
      clear();
    } catch {
      /* one broken cache must not block the others */
    }
  });
  try {
    purgeStorage(sessionStorage);
  } catch {
    /* ignore */
  }
  try {
    purgeStorage(localStorage);
  } catch {
    /* ignore */
  }
}
