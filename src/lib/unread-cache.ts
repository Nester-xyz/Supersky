import { browser, type Browser } from 'wxt/browser';

/** storage.local key the background keeps the last polled unread count in. */
export const LAST_COUNT_KEY = 'supersky:badge-count';
const CACHE_KEY = 'supersky:unread-cache';

/**
 * Synchronous last-known unread count, so the header dot paints on the first
 * frame instead of waiting for storage or the network (the auth-cache trick).
 */
export function readUnreadSnapshot(): number {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    const count = raw === null ? 0 : Number(raw);
    return Number.isFinite(count) && count > 0 ? Math.floor(count) : 0;
  } catch {
    return 0;
  }
}

export function writeUnreadCache(count: number): void {
  try {
    localStorage.setItem(CACHE_KEY, String(count));
  } catch {
    // Quota or privacy-mode hiccups just lose the head start.
  }
}

/** The background's last polled count, fresher than the popup's own cache. */
export async function readPolledUnread(): Promise<number | null> {
  try {
    const stored = await browser.storage.local.get(LAST_COUNT_KEY);
    const value = stored[LAST_COUNT_KEY];
    return typeof value === 'number' ? value : null;
  } catch {
    return null;
  }
}

/**
 * Fires whenever the background's poller learns a new count while the popup
 * is open (including the key being cleared when polling is switched off).
 */
export function onPolledUnreadChanged(callback: (count: number) => void): () => void {
  const listener = (changes: Record<string, Browser.storage.StorageChange>, area: string) => {
    if (area !== 'local' || !(LAST_COUNT_KEY in changes)) return;
    const next = changes[LAST_COUNT_KEY]?.newValue;
    callback(typeof next === 'number' ? next : 0);
  };
  browser.storage.onChanged.addListener(listener);
  return () => browser.storage.onChanged.removeListener(listener);
}
