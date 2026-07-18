/**
 * A synchronous mirror of the auth state in localStorage, so the popup can
 * decide, before rendering anything, whether to show the composer or hand off
 * to the settings page, AND paint the composer instantly from the last-known
 * account instead of waiting on the background session. The background remains
 * the source of truth; this is only a fast hint, reconciled on every open.
 */
import type { AccountSnapshot, AuthState } from './types';

const KEY = 'supersky:auth';

type SignedIn = { status: 'signed-in'; account: AccountSnapshot; accounts: AccountSnapshot[] };

function read(): AuthState | 'in' | 'out' | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    // Legacy / preview-mock value: a bare 'in' | 'out' string.
    if (raw === 'in' || raw === 'out') return raw;
    return JSON.parse(raw) as AuthState;
  } catch {
    return null;
  }
}

/** Fast signed-in/out hint used to decide the popup's very first paint. */
export function readAuthHint(): 'in' | 'out' | null {
  const value = read();
  if (value === 'in' || value === 'out' || value === null) return value;
  return value.status === 'signed-in' ? 'in' : 'out';
}

/**
 * The full last-known signed-in snapshot, when we have one, so the popup can
 * render the composer on the first frame. Null when unknown (e.g. the bare
 * 'in' hint), leaving the caller to wait for the async state.
 */
export function readAuthSnapshot(): SignedIn | null {
  const value = read();
  if (value && typeof value === 'object' && value.status === 'signed-in' && value.account) {
    return value;
  }
  return null;
}

export function writeAuthCache(state: AuthState): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    // localStorage may be unavailable; the async check still corrects things.
  }
}
