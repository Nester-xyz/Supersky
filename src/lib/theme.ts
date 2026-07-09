import { DEFAULT_ACCENT, ACCENT_IDS, type AccentId } from './accents';
import { loadSettings, watchSettings } from './settings';
import type { ThemePref } from './settings-schema';

const THEME_CACHE = 'supersky:theme-cache';
const ACCENT_CACHE = 'supersky:accent-cache';

export function resolveTheme(pref: ThemePref, systemDark: boolean): 'light' | 'dark' {
  if (pref === 'system') return systemDark ? 'dark' : 'light';
  return pref;
}

function systemPrefersDark(): boolean {
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

function writeCache(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // localStorage can be unavailable; theming still works, just a frame later.
  }
}

function readCache(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function applyTheme(pref: ThemePref): void {
  const dark = resolveTheme(pref, systemPrefersDark()) === 'dark';
  document.documentElement.classList.toggle('dark', dark);
  writeCache(THEME_CACHE, pref);
}

function applyAccent(accent: AccentId): void {
  document.documentElement.dataset.accent = accent;
  writeCache(ACCENT_CACHE, accent);
}

/**
 * Appearance boot for extension pages: paint immediately from the local cache
 * (no flash), then reconcile with stored settings and stay in sync with
 * settings changes and OS theme changes.
 */
export function initPageTheme(): void {
  const cachedTheme = readCache(THEME_CACHE);
  const cachedAccent = readCache(ACCENT_CACHE);
  let currentPref: ThemePref =
    cachedTheme === 'light' || cachedTheme === 'dark' ? cachedTheme : 'system';
  applyTheme(currentPref);
  applyAccent(ACCENT_IDS.includes(cachedAccent as AccentId) ? (cachedAccent as AccentId) : DEFAULT_ACCENT);

  void loadSettings().then((settings) => {
    currentPref = settings.theme;
    applyTheme(settings.theme);
    applyAccent(settings.accent);
  });
  watchSettings((settings) => {
    currentPref = settings.theme;
    applyTheme(settings.theme);
    applyAccent(settings.accent);
  });
  window
    .matchMedia('(prefers-color-scheme: dark)')
    .addEventListener('change', () => applyTheme(currentPref));
}
