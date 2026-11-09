/**
 * HTTP helpers every carrier's client shares.
 *
 * @module
 */

/**
 * Seconds a `Retry-After` value asks for: either delay-seconds or an HTTP
 * date (RFC 9110 §10.2.3). Null when absent or unreadable; never negative.
 */
export function parseRetryAfter(value: string | null, now: Date = new Date()): number | null {
  if (value == null) return null;
  const v = value.trim();
  if (/^\d+$/.test(v)) return Number(v);
  if (!/^[A-Za-z]{3},? /.test(v)) return null; // HTTP dates start with the weekday
  const at = Date.parse(v);
  if (Number.isNaN(at)) return null;
  return Math.max(0, Math.ceil((at - now.getTime()) / 1000));
}
