/** Date/countdown formatting. All outputs are pure LTR digit strings —
 * render them inside <MonoText> (which forces writingDirection ltr). */

const pad = (n: number): string => String(n).padStart(2, "0");

const intlLocale = (locale: "he" | "en"): string => (locale === "he" ? "he-IL" : "en-US");

/** Localized short date via Intl (he-IL / en-US); manual dd.mm fallback. */
export function formatDateIntl(
  iso: string | null | undefined,
  locale: "he" | "en" = "he",
): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  try {
    return new Intl.DateTimeFormat(intlLocale(locale), {
      day: "numeric",
      month: "numeric",
    }).format(d);
  } catch {
    return `${d.getDate()}.${d.getMonth() + 1}`;
  }
}

/** Localized month name (usage header). */
export function formatMonthName(locale: "he" | "en" = "he", d: Date = new Date()): string {
  try {
    return new Intl.DateTimeFormat(intlLocale(locale), { month: "long" }).format(d);
  } catch {
    return `${d.getMonth() + 1}.${d.getFullYear()}`;
  }
}

/** Localized weekday + short date, e.g. "יום ה׳ 20.8" (payout schedule). */
export function formatWeekdayDate(
  iso: string | null | undefined,
  locale: "he" | "en" = "he",
): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  try {
    return new Intl.DateTimeFormat(intlLocale(locale), {
      weekday: "short",
      day: "numeric",
      month: "numeric",
    }).format(d);
  } catch {
    return `${d.getDate()}.${d.getMonth() + 1}`;
  }
}

export function formatTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Local-time period starts for the earnings tabs. */
export function startOfToday(now: Date = new Date()): Date {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

/** Week starts Sunday (Israeli week). */
export function startOfWeek(now: Date = new Date()): Date {
  const d = startOfToday(now);
  d.setDate(d.getDate() - d.getDay());
  return d;
}

export function startOfMonth(now: Date = new Date()): Date {
  return new Date(now.getFullYear(), now.getMonth(), 1);
}

/** mm:ss under an hour, HH:mm above. Clamped at zero. */
export function formatCountdown(msRemaining: number): string {
  const total = Math.max(0, Math.floor(msRemaining / 1000));
  if (total < 3600) {
    return `${pad(Math.floor(total / 60))}:${pad(total % 60)}`;
  }
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  return `${pad(hours)}:${pad(minutes)}`;
}
