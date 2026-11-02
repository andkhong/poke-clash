import { createIntl, createIntlCache, type IntlShape } from 'react-intl';

export const LOCALES = ['en', 'es', 'de', 'fr', 'ja'] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = 'en';

/** English lives in each component's `defaultMessage`; other locales load on demand. */
const MESSAGES: Record<Exclude<Locale, 'en'>, () => Promise<{ default: Record<string, string> }>> = {
  es: () => import('./messages/es.json'),
  de: () => import('./messages/de.json'),
  fr: () => import('./messages/fr.json'),
  ja: () => import('./messages/ja.json'),
};

/** Each language in its own name, for the picker. */
export const LOCALE_NAMES: Record<Locale, string> = { en: 'English', es: 'Español', de: 'Deutsch', fr: 'Français', ja: '日本語' };
const STORAGE_KEY = 'lang';

const isLocale = (value: string): value is Locale => (LOCALES as readonly string[]).includes(value);

function savedLocale(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

/** `?lang=xx` wins, then the picker's saved choice, then the browser's preferred languages, then English. */
export function detectLocale(): Locale {
  const forced = new URLSearchParams(window.location.search).get('lang');
  for (const tag of [forced, savedLocale(), ...navigator.languages]) {
    const base = tag?.toLowerCase().split('-')[0];
    if (base && isLocale(base)) return base;
  }
  return DEFAULT_LOCALE;
}

const cache = createIntlCache();

/** For formatting outside React components (models, helpers). Set once by `initIntl` before the first render. */
export let intl: IntlShape = createIntl({ locale: DEFAULT_LOCALE, defaultLocale: DEFAULT_LOCALE }, cache);

/** Saves the choice and reloads, since messages are loaded once at startup. `?lang=` is rewritten too, so an old one can't override the choice. */
export function setLocale(locale: Locale): void {
  try {
    localStorage.setItem(STORAGE_KEY, locale);
  } catch {
    // No storage (private mode): the ?lang below still carries the choice for this tab.
  }
  const url = new URL(window.location.href);
  url.searchParams.set('lang', locale);
  window.location.replace(url);
}

export async function initIntl(locale: Locale = detectLocale()): Promise<IntlShape> {
  const messages = locale === 'en' ? {} : (await MESSAGES[locale]()).default;
  intl = createIntl({ locale, defaultLocale: DEFAULT_LOCALE, messages }, cache);
  document.documentElement.lang = locale;
  return intl;
}
