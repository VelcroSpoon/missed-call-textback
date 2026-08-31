import type { Call, Client } from "@/db/schema";
import { webhookUrl } from "@/lib/env";
import { logger } from "@/lib/logger";
import { redactPhone } from "@/lib/phone";
import { isQuietHours } from "@/lib/quiet-hours";
import { buildMessageBody, DEFAULT_TEMPLATE_BODY } from "@/lib/templates";
import { evaluateSuppression, type SuppressionReason } from "@/lib/suppression";
import { lookupLineType, sendSms } from "@/lib/twilio";
import * as repo from "./repo";

/** How long a cached Lookup result stays good. Line types change ~never. */
const LOOKUP_TTL_MS = 180 * 24 * 60 * 60 * 1000; // 180 days

/**
 * Resolve whether a number can receive SMS, using the cache first.
 *
 * A Lookup costs money on every call, so a cache miss is the only path that
 * hits Twilio, and even a null (inconclusive) result gets cached for the TTL
 * so a broken number does not get re-queried on every missed call.
 */
export async function resolveIsMobile(phoneNumber: string): Promise<boolean | null> {
  const cached = await repo.getCachedLookup(phoneNumber);
  if (cached && Date.now() - cached.checkedAt.getTime() < LOOKUP_TTL_MS) {
    return cached.isMobile;
  }

  try {
    const result = await lookupLineType(phoneNumber);
    await repo.saveLookup({ phoneNumber, ...result });
    return result.isMobile;
  } catch (error) {
    logger.warn("lookup.failed", {
      phone: redactPhone(phoneNumber),
      error: error instanceof Error ? error.message : String(error),
    });
    // Fail open: an outage on Twilio's Lookup API must not silently stop the
    // product from working. We do not cache failures.
    return null;
  }
}

export interface MissedCallResult {
  sent: boolean;
  reason: SuppressionReason | "send_failed" | null;
  messageSid?: string;
}

/**
 * Decide and, if appropriate, send the text-back for one missed call.
 *
 * The caller must already have won the idempotency race (see
 * repo.insertCallIfNew) — this function does not guard against duplicates.
 */
export async function handleMissedCall(
  client: Client,
  call: Call,
  now: Date = new Date(),
): Promise<MissedCallResult> {
  const caller = call.fromNumber;

  const optedOut = await repo.isOptedOut(client.id, caller);
  const quietHours = isQuietHours(now, client);

  // Only pay for a Lookup if the cheap checks have already passed.
  const needsLookup = client.active && !optedOut && !quietHours;
  const isMobile = needsLookup ? await resolveIsMobile(caller) : null;

  const template = await repo.getDefaultTemplate(client.id);

  const decision = evaluateSuppression({
    clientActive: client.active,
    optedOut,
    quietHours,
    isMobile: needsLookup ? isMobile : null,
  });

  if (!decision.send) {
    await repo.updateCallById(call.id, {
      suppressed: true,
      suppressionReason: decision.reason,
      smsSent: false,
    });
    logger.info("missed_call.suppressed", {
      client_id: client.id,
      call_sid: call.twilioCallSid,
      reason: decision.reason,
      caller: caller,
    });
    return { sent: false, reason: decision.reason };
  }

  const body = buildMessageBody(template?.body ?? DEFAULT_TEMPLATE_BODY, {
    business_name: client.name,
    caller_number: caller,
  });

  try {
    const message = await sendSms({
      to: caller,
      from: client.twilioNumber,
      body,
      statusCallback: webhookUrl("/api/sms/status"),
    });

    await repo.insertMessage({
      callId: call.id,
      clientId: client.id,
      direction: "outbound",
      body,
      twilioMessageSid: message.sid,
      status: message.status ?? "queued",
    });
    await repo.updateCallById(call.id, { smsSent: true, suppressed: false, suppressionReason: null });

    logger.info("missed_call.sms_sent", {
      client_id: client.id,
      call_sid: call.twilioCallSid,
      message_sid: message.sid,
      caller: caller,
    });
    return { sent: true, reason: null, messageSid: message.sid };
  } catch (error) {
    logger.error("missed_call.sms_failed", {
      client_id: client.id,
      call_sid: call.twilioCallSid,
      caller: caller,
      error: error instanceof Error ? error.message : String(error),
    });
    await repo.updateCallById(call.id, {
      smsSent: false,
      suppressed: true,
      suppressionReason: "send_failed",
    });
    return { sent: false, reason: "send_failed" };
  }
}
