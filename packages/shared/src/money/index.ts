/**
 * Money helpers. Storage/DB truth is ALWAYS integer agorot; config and
 * founder-facing values are shekels. Display is RTL-safe.
 */

export function shekelsToAgorot(shekels: number): number {
  return Math.round(shekels * 100);
}

export function agorotToShekels(agorot: number): number {
  return agorot / 100;
}

/** VAT split on an ex-VAT amount. Returns integer agorot, VAT rounded half-up. */
export function vatSplit(amountExVatAgorot: number, vatRate: number): {
  exVat: number;
  vat: number;
  total: number;
} {
  const vat = Math.round(amountExVatAgorot * vatRate);
  return { exVat: amountExVatAgorot, vat, total: amountExVatAgorot + vat };
}

/**
 * The "₪N נטו" figure pickers see, derived from the ex-VAT payout via the
 * net_display_factor config key. Whole shekels. DISPLAY ONLY.
 */
export function netDisplayShekels(exVatShekels: number, netDisplayFactor: number): number {
  return Math.round(exVatShekels * netDisplayFactor);
}

/** Left-to-right isolate so "₪42" never flips to "42₪" inside Hebrew text. */
const LRI = "⁦";
const PDI = "⁩";

export interface FormatOptions {
  /** wrap in Unicode LTR isolates for embedding inside RTL text (default true) */
  isolate?: boolean;
  /** show agorot when non-zero (default false → whole ₪ display) */
  withAgorot?: boolean;
}

export function formatILS(agorot: number, opts: FormatOptions = {}): string {
  const { isolate = true, withAgorot = false } = opts;
  const sign = agorot < 0 ? "-" : "";
  const abs = Math.abs(agorot);
  const whole = Math.floor(abs / 100);
  const rest = abs % 100;
  const grouped = whole.toLocaleString("en-US"); // 1,234 — digits stay Western
  const body =
    withAgorot && rest !== 0
      ? `₪${grouped}.${String(rest).padStart(2, "0")}`
      : `₪${grouped}`;
  const text = `${sign}${body}`;
  return isolate ? `${LRI}${text}${PDI}` : text;
}
