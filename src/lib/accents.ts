/**
 * The accent themes SuperSky ships. Each id maps to a set of CSS token
 * overrides in styles/theme.css (keyed by [data-accent="id"] for light and
 * .dark[data-accent="id"] for dark). This file is the source of truth for the
 * picker UI labels/swatches and the toolbar badge color (painted from JS, so
 * it can't read the CSS variables).
 */
export type AccentId = 'sky' | 'cyan' | 'emerald' | 'amber' | 'violet' | 'coral';

export interface AccentMeta {
  id: AccentId;
  label: string;
  /** Swatch gradient endpoints for the picker chip. */
  from: string;
  to: string;
  /** Toolbar badge background — a mid tone legible with white text. */
  badge: string;
}

export const ACCENTS: AccentMeta[] = [
  { id: 'sky', label: 'Sky Blue', from: '#2f6bff', to: '#45dcf3', badge: '#2f6bff' },
  { id: 'cyan', label: 'Cyan', from: '#14b6d6', to: '#7af0ff', badge: '#0e97b5' },
  { id: 'emerald', label: 'Emerald', from: '#10b981', to: '#5eead4', badge: '#0e9f6e' },
  { id: 'amber', label: 'Amber', from: '#f2a417', to: '#fcd34d', badge: '#e08c0a' },
  { id: 'violet', label: 'Violet', from: '#8b5cf6', to: '#d8b4fe', badge: '#7c3aed' },
  { id: 'coral', label: 'Coral', from: '#f43f5e', to: '#fb9db0', badge: '#f43f5e' },
];

export const ACCENT_IDS: readonly AccentId[] = ACCENTS.map((a) => a.id);
export const DEFAULT_ACCENT: AccentId = 'sky';

export function badgeColor(accent: AccentId): string {
  return ACCENTS.find((a) => a.id === accent)?.badge ?? '#2f6bff';
}
