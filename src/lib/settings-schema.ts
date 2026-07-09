import { ACCENT_IDS, DEFAULT_ACCENT, type AccentId } from './accents';

export type ThemePref = 'system' | 'light' | 'dark';

export interface Settings {
  theme: ThemePref;
  /** Accent color theme id; see lib/accents.ts. */
  accent: AccentId;
  /** BCP-47 language tag attached to new posts; empty string = unspecified. */
  defaultLang: string;
  /** Automatically turn the first URL in a post into a link card. */
  autoLinkCard: boolean;
  /** Show the unread-notifications count on the toolbar icon. */
  showBadge: boolean;
  /** Default PDS for new sign-ins. */
  service: string;
}

export const DEFAULT_SERVICE = 'https://bsky.social';

export const DEFAULT_SETTINGS: Settings = {
  theme: 'system',
  accent: DEFAULT_ACCENT,
  defaultLang: 'en',
  autoLinkCard: true,
  showBadge: true,
  service: DEFAULT_SERVICE,
};

const THEMES: readonly ThemePref[] = ['system', 'light', 'dark'];

/** Defensive merge of possibly-stale stored data into a valid Settings object. */
export function normalizeSettings(value: unknown): Settings {
  const raw = (value ?? {}) as Partial<Record<keyof Settings, unknown>>;
  return {
    theme: THEMES.includes(raw.theme as ThemePref) ? (raw.theme as ThemePref) : DEFAULT_SETTINGS.theme,
    accent: ACCENT_IDS.includes(raw.accent as AccentId) ? (raw.accent as AccentId) : DEFAULT_SETTINGS.accent,
    defaultLang: typeof raw.defaultLang === 'string' ? raw.defaultLang : DEFAULT_SETTINGS.defaultLang,
    autoLinkCard:
      typeof raw.autoLinkCard === 'boolean' ? raw.autoLinkCard : DEFAULT_SETTINGS.autoLinkCard,
    showBadge: typeof raw.showBadge === 'boolean' ? raw.showBadge : DEFAULT_SETTINGS.showBadge,
    service: isValidServiceUrl(raw.service) ? (raw.service as string) : DEFAULT_SETTINGS.service,
  };
}

export function isValidServiceUrl(value: unknown): boolean {
  if (typeof value !== 'string' || !value) return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:';
  } catch {
    return false;
  }
}
