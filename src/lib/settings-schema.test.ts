import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, isValidServiceUrl, normalizeSettings } from './settings-schema';

describe('normalizeSettings', () => {
  it('returns defaults for missing or malformed input', () => {
    expect(normalizeSettings(undefined)).toEqual(DEFAULT_SETTINGS);
    expect(normalizeSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(normalizeSettings('garbage')).toEqual(DEFAULT_SETTINGS);
  });

  it('keeps valid stored values', () => {
    const stored = {
      theme: 'dark',
      accent: 'violet',
      defaultLang: 'ne',
      autoLinkCard: false,
      showBadge: false,
      service: 'https://pds.example.com',
    };
    expect(normalizeSettings(stored)).toEqual(stored);
  });

  it('repairs individual invalid fields without touching valid ones', () => {
    const result = normalizeSettings({
      theme: 'neon',
      accent: 'chartreuse',
      defaultLang: 42,
      autoLinkCard: 'yes',
      showBadge: true,
      service: 'ftp://nope',
    });
    expect(result.theme).toBe(DEFAULT_SETTINGS.theme);
    expect(result.accent).toBe(DEFAULT_SETTINGS.accent);
    expect(result.defaultLang).toBe(DEFAULT_SETTINGS.defaultLang);
    expect(result.autoLinkCard).toBe(DEFAULT_SETTINGS.autoLinkCard);
    expect(result.showBadge).toBe(true);
    expect(result.service).toBe(DEFAULT_SETTINGS.service);
  });
});

describe('isValidServiceUrl', () => {
  it('accepts http(s) URLs and rejects everything else', () => {
    expect(isValidServiceUrl('https://bsky.social')).toBe(true);
    expect(isValidServiceUrl('http://localhost:2583')).toBe(true);
    expect(isValidServiceUrl('ftp://x')).toBe(false);
    expect(isValidServiceUrl('bsky.social')).toBe(false);
    expect(isValidServiceUrl('')).toBe(false);
    expect(isValidServiceUrl(42)).toBe(false);
  });
});
