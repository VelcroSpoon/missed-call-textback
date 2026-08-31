/**
 * Phone number helpers. Twilio always hands us E.164, but user-entered values
 * (settings form, seed script, admin) need normalising before they go near the
 * database or an opt-out comparison.
 */

/**
 * Best-effort E.164 normalisation. Defaults to +1 for 10-digit input, which is
 * correct for the US/Canada market this product targets. Returns null when the
 * input cannot be made into something E.164-shaped.
 */
export function normalizePhone(input: string | null | undefined): string | null {
  if (!input) return null;
  const trimmed = input.trim();
  if (!trimmed) return null;

  const hadPlus = trimmed.startsWith("+");
  const digits = trimmed.replace(/\D/g, "");
  if (!digits) return null;

  if (hadPlus) {
    return digits.length >= 8 && digits.length <= 15 ? `+${digits}` : null;
  }
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  if (digits.length >= 11 && digits.length <= 15) return `+${digits}`;
  return null;
}

/** Throwing variant, for code paths where a bad number is a programming error. */
export function requirePhone(input: string | null | undefined, label = "phone number"): string {
  const normalized = normalizePhone(input);
  if (!normalized) throw new Error(`Invalid ${label}: ${redactPhone(input ?? "")}`);
  return normalized;
}

/**
 * Redact for logs. Never log a full phone number at info level — these are
 * end-customer PII belonging to our clients' callers, not to us.
 * "+15551234567" -> "+1555***4567"
 */
export function redactPhone(phone: string | null | undefined): string {
  if (!phone) return "<none>";
  if (phone.length <= 6) return "***";
  return `${phone.slice(0, 4)}***${phone.slice(-4)}`;
}

/** Pretty US-style display for the dashboard. Falls back to the raw value. */
export function formatPhone(phone: string | null | undefined): string {
  if (!phone) return "Unknown";
  const m = /^\+1(\d{3})(\d{3})(\d{4})$/.exec(phone);
  if (m) return `(${m[1]}) ${m[2]}-${m[3]}`;
  return phone;
}
