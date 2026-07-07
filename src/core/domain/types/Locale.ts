export interface LocaleConfig {
  code:        string;
  name:        string;
  ttsLanguage: string;
}

export const LOCALES: Record<string, LocaleConfig> = {
  en: { code: 'en', name: 'English', ttsLanguage: 'en-US' },
  fr: { code: 'fr', name: 'French',  ttsLanguage: 'fr-FR' },
  de: { code: 'de', name: 'German',  ttsLanguage: 'de-DE' },
  es: { code: 'es', name: 'Spanish', ttsLanguage: 'es-ES' },
  it: { code: 'it', name: 'Italian', ttsLanguage: 'it-IT' },
  ja: { code: 'ja', name: 'Japanese', ttsLanguage: 'ja-JP' },
  pt: { code: 'pt', name: 'Portuguese', ttsLanguage: 'pt-PT' },
};

export function resolveLocale(code: string): LocaleConfig {
  return LOCALES[code] ?? LOCALES['en'];
}

export function isEnglish(locale: string | undefined): boolean {
  return !locale || locale === 'en' || locale.startsWith('en-');
}
