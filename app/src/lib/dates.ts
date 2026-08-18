/** Date/countdown formatting. All outputs are pure LTR digit strings —
 * render them inside <MonoText> (which forces writingDirection ltr). */

const pad = (n: number): string => String(n).padStart(2, "0");

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()}`;
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
