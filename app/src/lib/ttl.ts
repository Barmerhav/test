/**
 * TTL chips come from the `request_ttl_options` config key. A chip is hidden
 * once its cutoff (HH:MM in the config `timezone`) has passed today.
 */
export interface TtlOption {
  key: string;
  cutoff: string; // HH:MM 24h, zero padded
}

/** Current HH:MM in an IANA timezone; falls back to device time when the
 * runtime lacks Intl timezone data. */
export function hhmmInTimeZone(timeZone: string, now: Date = new Date()): string {
  try {
    const fmt = new Intl.DateTimeFormat("en-GB", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
      timeZone,
    });
    const s = fmt.format(now);
    if (/^\d{2}:\d{2}$/.test(s)) return s;
  } catch {
    // fall through to device time
  }
  const pad = (n: number): string => String(n).padStart(2, "0");
  return `${pad(now.getHours())}:${pad(now.getMinutes())}`;
}

/** Zero-padded HH:MM strings compare correctly as plain strings. */
export function visibleTtlOptions(
  options: TtlOption[],
  timezone: string,
  now: Date = new Date(),
): TtlOption[] {
  const current = hhmmInTimeZone(timezone, now);
  return options.filter((o) => o.cutoff > current);
}

export function defaultTtlKey(
  visible: TtlOption[],
  configuredDefault: string,
): string | null {
  if (visible.some((o) => o.key === configuredDefault)) return configuredDefault;
  return visible[0]?.key ?? null;
}
