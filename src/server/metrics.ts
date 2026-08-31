import { and, count, desc, eq, gte, lt, sql } from "drizzle-orm";
import { db } from "@/db";
import { calls, messages } from "@/db/schema";
import { monthWindow } from "@/lib/tz";

export interface HeadlineMetrics {
  thisMonth: number;
  lastMonth: number;
  /** null when last month was zero — a percentage change is undefined there. */
  percentChange: number | null;
  thisMonthLabel: string;
  lastMonthLabel: string;
}

async function countMissed(clientId: string, start: Date, end: Date): Promise<number> {
  const rows = await db
    .select({ value: count() })
    .from(calls)
    .where(
      and(
        eq(calls.clientId, clientId),
        eq(calls.missed, true),
        gte(calls.createdAt, start),
        lt(calls.createdAt, end),
      ),
    );
  return rows[0]?.value ?? 0;
}

export async function getHeadlineMetrics(
  clientId: string,
  timezone: string,
  now: Date = new Date(),
): Promise<HeadlineMetrics> {
  const current = monthWindow(now, timezone, 0);
  const previous = monthWindow(now, timezone, 1);

  const [thisMonth, lastMonth] = await Promise.all([
    countMissed(clientId, current.start, current.end),
    countMissed(clientId, previous.start, previous.end),
  ]);

  return {
    thisMonth,
    lastMonth,
    percentChange: lastMonth === 0 ? null : ((thisMonth - lastMonth) / lastMonth) * 100,
    thisMonthLabel: current.label,
    lastMonthLabel: previous.label,
  };
}

export interface RecoveryMetrics {
  missedWithSms: number;
  replied: number;
  /** null when we have not texted anyone yet this month. */
  rate: number | null;
}

/**
 * Recovery rate = of the missed calls where we actually sent a text, what
 * share got an inbound reply attributed back to that call.
 *
 * Calls where the SMS was suppressed are excluded from the denominator —
 * counting a quiet-hours suppression as a failed recovery would understate the
 * product's performance.
 */
export async function getRecoveryMetrics(
  clientId: string,
  timezone: string,
  now: Date = new Date(),
): Promise<RecoveryMetrics> {
  const current = monthWindow(now, timezone, 0);

  const rows = await db
    .select({
      missedWithSms: count(),
      replied: sql<number>`count(*) filter (where exists (
        select 1 from ${messages}
        where ${messages.callId} = ${calls.id}
          and ${messages.direction} = 'inbound'
      ))`.mapWith(Number),
    })
    .from(calls)
    .where(
      and(
        eq(calls.clientId, clientId),
        eq(calls.missed, true),
        eq(calls.smsSent, true),
        gte(calls.createdAt, current.start),
        lt(calls.createdAt, current.end),
      ),
    );

  const missedWithSms = rows[0]?.missedWithSms ?? 0;
  const replied = rows[0]?.replied ?? 0;

  return {
    missedWithSms,
    replied,
    rate: missedWithSms === 0 ? null : (replied / missedWithSms) * 100,
  };
}

export interface MissedCallRow {
  id: string;
  createdAt: Date;
  fromNumber: string;
  status: string;
  smsSent: boolean;
  suppressed: boolean;
  suppressionReason: string | null;
  replied: boolean;
}

export async function getRecentMissedCalls(
  clientId: string,
  limit = 50,
): Promise<MissedCallRow[]> {
  const rows = await db
    .select({
      id: calls.id,
      createdAt: calls.createdAt,
      fromNumber: calls.fromNumber,
      status: calls.status,
      smsSent: calls.smsSent,
      suppressed: calls.suppressed,
      suppressionReason: calls.suppressionReason,
      replied: sql<boolean>`exists (
        select 1 from ${messages}
        where ${messages.callId} = ${calls.id}
          and ${messages.direction} = 'inbound'
      )`,
    })
    .from(calls)
    .where(and(eq(calls.clientId, clientId), eq(calls.missed, true)))
    .orderBy(desc(calls.createdAt))
    .limit(limit);

  return rows as MissedCallRow[];
}
