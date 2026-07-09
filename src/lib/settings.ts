import { browser } from 'wxt/browser';
import { normalizeSettings, type Settings } from './settings-schema';

export { DEFAULT_SETTINGS, DEFAULT_SERVICE, normalizeSettings } from './settings-schema';
export type { Settings, ThemePref } from './settings-schema';
export type { AccentId } from './accents';

const KEY = 'supersky:settings';

export async function loadSettings(): Promise<Settings> {
  const stored = await browser.storage.sync.get(KEY);
  return normalizeSettings(stored[KEY]);
}

export async function saveSettings(patch: Partial<Settings>): Promise<Settings> {
  const next: Settings = { ...(await loadSettings()), ...patch };
  await browser.storage.sync.set({ [KEY]: next });
  return next;
}

/** Subscribe to settings changes from any extension context. Returns unsubscribe. */
export function watchSettings(callback: (settings: Settings) => void): () => void {
  const listener = (
    changes: Record<string, { newValue?: unknown }>,
    areaName: string,
  ) => {
    if (areaName === 'sync' && changes[KEY]) {
      callback(normalizeSettings(changes[KEY].newValue));
    }
  };
  browser.storage.onChanged.addListener(listener);
  return () => browser.storage.onChanged.removeListener(listener);
}
