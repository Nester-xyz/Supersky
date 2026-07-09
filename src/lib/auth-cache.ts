/**
 * A synchronous mirror of the auth state in localStorage, so the popup can
 * decide — before rendering anything — whether to show the composer or hand
 * off to the settings page. The source of truth is still the background
 * session; this is only a fast hint written whenever a page learns the state.
 */
const KEY = 'supersky:auth';

export type AuthCache = 'in' | 'out';

export function readAuthCache(): AuthCache | null {
  try {
    const value = localStorage.getItem(KEY);
    return value === 'in' || value === 'out' ? value : null;
  } catch {
    return null;
  }
}

export function writeAuthCache(state: AuthCache): void {
  try {
    localStorage.setItem(KEY, state);
  } catch {
    // localStorage may be unavailable; the async check still corrects things.
  }
}
