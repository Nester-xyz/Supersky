/**
 * The accent themes Supersky ships. Each id maps to a set of CSS token
 * overrides in styles/theme.css (keyed by [data-accent="id"] for light and
 * .dark[data-accent="id"] for dark). This file is the source of truth for the
 * picker UI labels/swatches and the toolbar badge color (painted from JS, so
 * it can't read the CSS variables).
 */
export type AccentId =
  | 'sky'
  | 'indigo'
  | 'cyan'
  | 'emerald'
  | 'amber'
  | 'sunset'
  | 'coral'
  | 'orchid'
  | 'violet';

export interface AccentMeta {
  id: AccentId;
  label: string;
  /** Swatch gradient endpoints for the picker chip. */
  from: string;
  to: string;
  /** Toolbar badge background: a mid tone legible with white text. */
  badge: string;
}

export const ACCENTS: AccentMeta[] = [
  { id: 'sky', label: 'Sky Blue', from: '#2f6bff', to: '#45dcf3', badge: '#2f6bff' },
  { id: 'indigo', label: 'Indigo', from: '#4f46e5', to: '#a5b4fc', badge: '#5558e3' },
  { id: 'cyan', label: 'Cyan', from: '#14b6d6', to: '#67e8f9', badge: '#0e97b5' },
  { id: 'emerald', label: 'Emerald', from: '#10b981', to: '#6ee7b7', badge: '#0e9f6e' },
  { id: 'amber', label: 'Amber', from: '#f2a417', to: '#fcd34d', badge: '#e08c0a' },
  { id: 'sunset', label: 'Sunset', from: '#f97316', to: '#fdba74', badge: '#ed6a13' },
  { id: 'coral', label: 'Coral', from: '#f43f5e', to: '#fda4af', badge: '#f43f5e' },
  { id: 'orchid', label: 'Orchid', from: '#d946ef', to: '#f0abfc', badge: '#c936da' },
  { id: 'violet', label: 'Violet', from: '#8b5cf6', to: '#c4b5fd', badge: '#7c3aed' },
];

export const ACCENT_IDS: readonly AccentId[] = ACCENTS.map((a) => a.id);
export const DEFAULT_ACCENT: AccentId = 'sky';

export function badgeColor(accent: AccentId): string {
  return ACCENTS.find((a) => a.id === accent)?.badge ?? '#2f6bff';
}
