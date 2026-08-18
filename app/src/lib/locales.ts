import type { Locale } from "./types";

/**
 * Language endonyms — each language's own name for itself. These are
 * universal proper nouns (identical in every UI locale), not translatable
 * copy, so they intentionally live outside the strings table.
 */
export const LANGUAGE_ENDONYMS: Record<Locale, string> = {
  he: "עברית",
  en: "English",
};

export const LOCALES: Locale[] = ["he", "en"];
