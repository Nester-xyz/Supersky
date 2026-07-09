export interface LanguageOption {
  value: string;
  label: string;
}

/** Curated post-language list; value is a BCP-47 tag, empty = unspecified. */
export const LANGUAGES: LanguageOption[] = [
  { value: '', label: 'Not specified' },
  { value: 'en', label: 'English' },
  { value: 'es', label: 'Español' },
  { value: 'pt', label: 'Português' },
  { value: 'fr', label: 'Français' },
  { value: 'de', label: 'Deutsch' },
  { value: 'it', label: 'Italiano' },
  { value: 'nl', label: 'Nederlands' },
  { value: 'pl', label: 'Polski' },
  { value: 'sv', label: 'Svenska' },
  { value: 'da', label: 'Dansk' },
  { value: 'fi', label: 'Suomi' },
  { value: 'nb', label: 'Norsk' },
  { value: 'tr', label: 'Türkçe' },
  { value: 'ru', label: 'Русский' },
  { value: 'uk', label: 'Українська' },
  { value: 'ar', label: 'العربية' },
  { value: 'fa', label: 'فارسی' },
  { value: 'hi', label: 'हिन्दी' },
  { value: 'ne', label: 'नेपाली' },
  { value: 'bn', label: 'বাংলা' },
  { value: 'id', label: 'Bahasa Indonesia' },
  { value: 'th', label: 'ไทย' },
  { value: 'vi', label: 'Tiếng Việt' },
  { value: 'ja', label: '日本語' },
  { value: 'ko', label: '한국어' },
  { value: 'zh', label: '中文' },
];

export function languageLabel(value: string): string {
  return LANGUAGES.find((lang) => lang.value === value)?.label ?? value;
}
