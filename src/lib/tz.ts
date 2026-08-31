/**
 * Minimal timezone maths for the dashboard, using Intl instead of pulling in a
 * date library. "This month" has to mean this month *where the business is*,
 * not where the Vercel region happens to be.
 */

function offsetMs(at: Date, timeZone: string): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  const parts = Object.fromEntries(dtf.formatToParts(at).map((p) => [p.type, p.value]));
  const asUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second),
  );
  return asUtc - at.getTime();
}

/** The UTC instant corresponding to a wall-clock time in `timeZone`. */
export function zonedToUtc(
  year: number,
  monthIndex: number,
  day: number,
  timeZone: string,
): Date {
  const guess = Date.UTC(year, monthIndex, day, 0, 0, 0);
  const offset = offsetMs(new Date(guess), timeZone);
  return new Date(guess - offset);
}

/** Calendar year/month of `at` as seen in `timeZone`. */
export function zonedYearMonth(at: Date, timeZone: string): { year: number; monthIndex: number } {
  const dtf = new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "2-digit" });
  const parts = Object.fromEntries(dtf.formatToParts(at).map((p) => [p.type, p.value]));
  return { year: Number(parts.year), monthIndex: Number(parts.month) - 1 };
}

export interface MonthWindow {
  start: Date;
  end: Date;
  label: string;
}

/**
 * Month boundaries in the client's timezone.
 * `monthsAgo` 0 = current month, 1 = last month.
 */
export function monthWindow(at: Date, timeZone: string, monthsAgo = 0): MonthWindow {
  const { year, monthIndex } = zonedYearMonth(at, timeZone);
  const target = new Date(Date.UTC(year, monthIndex - monthsAgo, 1));
  const y = target.getUTCFullYear();
  const m = target.getUTCMonth();

  const start = zonedToUtc(y, m, 1, timeZone);
  const end = zonedToUtc(m === 11 ? y + 1 : y, m === 11 ? 0 : m + 1, 1, timeZone);
  const label = new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    month: "long",
    year: "numeric",
  }).format(target);

  return { start, end, label };
}

/** Format an instant for display in the client's timezone. */
export function formatInZone(at: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(at);
}
