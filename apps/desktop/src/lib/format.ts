import { currentLocale, intlLocale, t, type Locale } from "../i18n";

const number = (value: number, digits: number, locale: Locale) =>
  new Intl.NumberFormat(intlLocale(locale), {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value);

export function formatBytes(
  bytes: number | null | undefined,
  locale: Locale = currentLocale(),
): string {
  if (bytes == null) return "—";
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${number(value, value < 10 ? 1 : 0, locale)} ${units[unit]}`;
}

export function formatDimensions(w: number | null | undefined, h: number | null | undefined) {
  return w && h ? `${w} × ${h} px` : "—";
}

/** Date and time in the active UI language ("09/10/2026, 18:05" / "10/9/2026, 6:05 PM"). */
export function formatDateTime(iso: string, locale: Locale = currentLocale()): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString(intlLocale(locale));
}

export function formatRelativeTime(iso: string, now = Date.now()): string {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return "—";
  const diff = Math.max(0, now - then);
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (diff < minute) return t("format.justNow");
  if (diff < hour) return t("format.minutesAgo", { count: Math.floor(diff / minute) });
  if (diff < day) return t("format.hoursAgo", { count: Math.floor(diff / hour) });
  if (diff < 7 * day) return t("format.daysAgo", { count: Math.floor(diff / day) });
  return new Date(then).toLocaleDateString(intlLocale(currentLocale()));
}
