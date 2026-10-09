/**
 * Tiny typed i18n for the desktop UI (no library). `en` is the source of truth; `vi` has the
 * same shape, so a missing key is a compile error.
 *
 * Only what the user reads is translated. Prompts sent to providers, DNA values, ids and
 * anything persisted stay as they are.
 *
 * - `useT()` in components: re-renders on a language switch.
 * - `t()` in plain modules (store, pure helpers): reads the current language at call time.
 * - The choice lives in `localStorage["arch.locale"]` (a UI preference; never sent anywhere).
 */
import { useCallback } from "react";
import { create } from "zustand";
import { en, type Plural } from "./en";
import { vi } from "./vi";

export type Locale = "en" | "vi";
export const LOCALES: readonly Locale[] = ["vi", "en"];
export const DEFAULT_LOCALE: Locale = "vi";
export const LOCALE_STORAGE_KEY = "arch.locale";

/** Same shape as `en`, every leaf widened to string. */
export type Dict = Widen<typeof en>;
type Widen<T> = T extends string
  ? string
  : T extends Plural
    ? Plural
    : { readonly [K in keyof T]: Widen<T[K]> };

/** Every dotted key of the dictionary, e.g. "hub.newProject". */
export type TKey = Paths<typeof en>;
type Paths<T> = {
  [K in keyof T & string]: T[K] extends string | Plural ? K : `${K}.${Paths<T[K]>}`;
}[keyof T & string];

export type TParams = Record<string, string | number>;
export type TFunction = (key: TKey, params?: TParams) => string;

export const DICTIONARIES: Record<Locale, Dict> = { en, vi };

/** BCP 47 tag for `Intl` formatting. */
export const intlLocale = (l: Locale) => (l === "vi" ? "vi-VN" : "en-US");

function readStoredLocale(): Locale {
  try {
    const v = globalThis.localStorage?.getItem(LOCALE_STORAGE_KEY);
    return v === "en" || v === "vi" ? v : DEFAULT_LOCALE;
  } catch {
    return DEFAULT_LOCALE;
  }
}

type LocaleState = { locale: Locale; setLocale: (l: Locale) => void };

export const useLocale = create<LocaleState>((set) => ({
  locale: readStoredLocale(),
  setLocale: (locale) => {
    try {
      globalThis.localStorage?.setItem(LOCALE_STORAGE_KEY, locale);
    } catch {
      // Storage blocked: the switch still works for this session.
    }
    if (typeof document !== "undefined") document.documentElement.lang = locale;
    set({ locale });
  },
}));

/** Re-read the stored choice (tests simulate an app restart with it). */
export function reloadLocale() {
  useLocale.setState({ locale: readStoredLocale() });
}

function lookup(dict: Dict, key: string): string | Plural | undefined {
  let cur: unknown = dict;
  for (const part of key.split(".")) {
    if (cur === null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return typeof cur === "string" || isPlural(cur) ? cur : undefined;
}

function isPlural(v: unknown): v is Plural {
  return !!v && typeof v === "object" && "one" in v && "other" in v;
}

/** Translate `key` in `locale`; `{name}` placeholders are filled from `params`. */
export function translate(locale: Locale, key: TKey, params?: TParams): string {
  const entry = lookup(DICTIONARIES[locale], key) ?? lookup(en, key) ?? key;
  const template = isPlural(entry) ? (params?.count === 1 ? entry.one : entry.other) : entry;
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (m, name: string) =>
    name in params ? String(params[name]) : m,
  );
}

/** Translate with the current language (for code outside React components). */
export const t: TFunction = (key, params) => translate(useLocale.getState().locale, key, params);

/** Translate in a component; the component re-renders when the language changes. */
export function useT(): TFunction {
  const locale = useLocale((s) => s.locale);
  return useCallback<TFunction>((key, params) => translate(locale, key, params), [locale]);
}

export const currentLocale = () => useLocale.getState().locale;
