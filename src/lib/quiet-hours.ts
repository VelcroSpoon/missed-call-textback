/**
 * Quiet hours are evaluated in the client's own timezone, using Intl rather
 * than a date library so there is no tz-database dependency to keep in sync.
 */

export interface QuietHoursConfig {
  timezone: string;
  quietHoursEnabled: boolean;
  /** "HH:MM", 24-hour, local to `timezone`. */
  quietHoursStart: string;
  quietHoursEnd: string;
}

/** Minutes since local midnight, e.g. "21:30" -> 1290. Null when unparseable. */
export function parseTimeOfDay(value: string | null | undefined): number | null {
  if (!value) return null;
  const m = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!m) return null;
  const hours = Number(m[1]);
  const minutes = Number(m[2]);
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}

/** Minutes since local midnight for `at` in `timezone`. */
export function minutesInTimezone(at: Date, timezone: string): number {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const parts = formatter.formatToParts(at);
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? "0");
  const minute = Number(parts.find((p) => p.type === "minute")?.value ?? "0");
  return hour * 60 + minute;
}

/**
 * True when `at` falls inside the client's quiet window. The window is allowed
 * to wrap midnight (the default 21:00 -> 08:00 does).
 *
 * A window whose start equals its end is treated as "never quiet", not
 * "always quiet" — the failure mode of silently muting a client forever is
 * much worse than the failure mode of one extra text.
 */
export function isQuietHours(at: Date, config: QuietHoursConfig): boolean {
  if (!config.quietHoursEnabled) return false;

  const start = parseTimeOfDay(config.quietHoursStart);
  const end = parseTimeOfDay(config.quietHoursEnd);
  if (start === null || end === null || start === end) return false;

  let now: number;
  try {
    now = minutesInTimezone(at, config.timezone);
  } catch {
    // Invalid IANA zone: fail open rather than muting the client.
    return false;
  }

  if (start < end) return now >= start && now < end;
  // Wrapping window: 21:00 -> 08:00
  return now >= start || now < end;
}

/** Human-readable window for the settings UI. */
export function describeQuietHours(config: QuietHoursConfig): string {
  if (!config.quietHoursEnabled) return "Disabled — texts send at any hour";
  return `${config.quietHoursStart} to ${config.quietHoursEnd} (${config.timezone})`;
}
