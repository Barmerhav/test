/** Minimal base64 → bytes decoder (Hermes-safe, no atob dependency).
 * Used to turn expo-camera base64 captures into ArrayBuffers for storage. */

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

const LOOKUP: Record<string, number> = {};
for (let i = 0; i < ALPHABET.length; i += 1) {
  const ch = ALPHABET[i];
  if (ch !== undefined) LOOKUP[ch] = i;
}

export function base64ToBytes(b64: string): Uint8Array {
  const clean = b64.replace(/[^A-Za-z0-9+/]/g, "");
  const padLess = clean.length;
  const byteLength = Math.floor((padLess * 3) / 4);
  const bytes = new Uint8Array(byteLength);

  let byteIndex = 0;
  for (let i = 0; i + 1 < padLess; i += 4) {
    const a = LOOKUP[clean[i] ?? ""] ?? 0;
    const b = LOOKUP[clean[i + 1] ?? ""] ?? 0;
    const c = clean[i + 2] !== undefined ? (LOOKUP[clean[i + 2] ?? ""] ?? 0) : -1;
    const d = clean[i + 3] !== undefined ? (LOOKUP[clean[i + 3] ?? ""] ?? 0) : -1;

    if (byteIndex < byteLength) bytes[byteIndex++] = (a << 2) | (b >> 4);
    if (c >= 0 && byteIndex < byteLength) bytes[byteIndex++] = ((b & 15) << 4) | (c >> 2);
    if (d >= 0 && byteIndex < byteLength) bytes[byteIndex++] = ((c & 3) << 6) | d;
  }
  return bytes;
}

export function base64ToArrayBuffer(b64: string): ArrayBuffer {
  const bytes = base64ToBytes(b64);
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}
