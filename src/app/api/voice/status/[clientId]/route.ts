import { logger } from "@/lib/logger";
import { redactPhone } from "@/lib/phone";
import {
  EMPTY_TWIML,
  forbidden,
  twimlResponse,
  verifyTwilioRequest,
} from "@/lib/twilio-signature";
import { handleMissedCall } from "@/server/missed-call";
import * as repo from "@/server/repo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** DialCallStatus values that mean the business did not pick up. */
const MISSED_STATUSES = new Set(["no-answer", "busy", "failed"]);

function toInt(value: string | undefined): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

/**
 * POST /api/voice/status/[clientId]
 *
 * Serves two Twilio callbacks:
 *
 *  - The <Dial> *action* callback, which carries DialCallStatus. This is the
 *    one that decides whether to text back.
 *  - The <Number> *statusCallback* (?src=child), which fires per leg event and
 *    carries no DialCallStatus. Logged only; it must never create a call row,
 *    or it would consume the idempotency key before the action callback runs.
 */
export async function POST(
  req: Request,
  ctx: { params: Promise<{ clientId: string }> },
) {
  const { clientId } = await ctx.params;

  const verification = await verifyTwilioRequest(req);
  if (!verification.valid) {
    logger.warn("voice_status.rejected", { client_id: clientId, reason: verification.reason });
    return forbidden(verification.reason);
  }
  const params = verification.params;
  const dialCallStatus = params.DialCallStatus;

  if (!dialCallStatus) {
    logger.debug("voice_status.leg_event", {
      client_id: clientId,
      call_sid: params.CallSid,
      parent_call_sid: params.ParentCallSid,
      call_status: params.CallStatus,
    });
    return twimlResponse(EMPTY_TWIML);
  }

  const client = await repo.getClientById(clientId);
  if (!client) {
    logger.warn("voice_status.unknown_client", { client_id: clientId });
    // 200 so Twilio stops retrying a callback we can never satisfy.
    return twimlResponse(EMPTY_TWIML);
  }

  const missed = MISSED_STATUSES.has(dialCallStatus);

  // Idempotency gate: the unique index on twilio_call_sid means only the first
  // delivery of this callback gets a row back. Retries fall through with null
  // and therefore never send a second SMS.
  const call = await repo.insertCallIfNew({
    clientId: client.id,
    twilioCallSid: params.CallSid,
    fromNumber: params.From,
    toNumber: params.To,
    status: dialCallStatus,
    durationSeconds: toInt(params.DialCallDuration),
    missed,
  });

  if (!call) {
    logger.info("voice_status.duplicate_ignored", {
      client_id: client.id,
      call_sid: params.CallSid,
      dial_call_status: dialCallStatus,
    });
    return twimlResponse(EMPTY_TWIML);
  }

  logger.info("voice_status.recorded", {
    client_id: client.id,
    call_sid: params.CallSid,
    dial_call_status: dialCallStatus,
    missed,
    caller: redactPhone(params.From),
  });

  if (missed) {
    await handleMissedCall(client, call);
  }

  // Empty TwiML ends the call, which is what we want once the dial is over.
  return twimlResponse(EMPTY_TWIML);
}
