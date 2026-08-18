/**
 * Israeli mobile phone normalization. UI accepts "05x-xxxxxxx" style input;
 * auth always gets E.164 (+9725xxxxxxxx).
 */
export function normalizeILPhone(raw: string): string | null {
  const t = raw.replace(/[\s\-().]/g, "");
  if (/^\+9725\d{8}$/.test(t)) return t;
  if (/^9725\d{8}$/.test(t)) return `+${t}`;
  if (/^05\d{8}$/.test(t)) return `+972${t.slice(1)}`;
  return null;
}

/** Loose partial check so the CTA can enable/disable while typing. */
export function isCompleteILPhone(raw: string): boolean {
  return normalizeILPhone(raw) !== null;
}
