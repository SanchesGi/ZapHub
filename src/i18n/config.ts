// Supported UI languages. To add one, create `messages/<locale>.json` with the
// same keys as `en.json`, then register it here and in `localeNames`.
// minha versao: so portugues (padrao) e ingles — o indonesio ("id") foi removido
export const locales = ["pt-BR", "en"] as const;

export type Locale = (typeof locales)[number];

export const fallbackLocale: Locale = "pt-BR";

// Cookie that stores the language picked in the UI
export const LOCALE_COOKIE = "NEXT_LOCALE";

// Native names, shown in the language switcher
export const localeNames: Record<Locale, string> = {
    "pt-BR": "Português (Brasil)",
    en: "English",
};

export function isLocale(value: unknown): value is Locale {
    return typeof value === "string" && (locales as readonly string[]).includes(value);
}

/**
 * Match a raw value (cookie, env var) to a supported locale.
 * Case-insensitive, and falls back to the base language: "pt-br" → "pt-BR", "id-ID" → "id", "en-US" → "en".
 */
export function matchLocale(value: string | null | undefined): Locale | undefined {
    if (!value) return undefined;
    const normalized = value.trim().toLowerCase();
    if (!normalized) return undefined;

    const exact = locales.find((l) => l.toLowerCase() === normalized);
    if (exact) return exact;

    const base = normalized.split(/[-_]/)[0];
    return locales.find((l) => l.toLowerCase() === base)
        ?? locales.find((l) => l.toLowerCase().split("-")[0] === base);
}

/**
 * Resolve the active locale: user cookie → DEFAULT_LANGUAGE env → Portuguese (minha versao).
 */
export function resolveLocale(cookieValue?: string | null, envDefault?: string | null): Locale {
    return matchLocale(cookieValue) ?? matchLocale(envDefault) ?? fallbackLocale;
}
