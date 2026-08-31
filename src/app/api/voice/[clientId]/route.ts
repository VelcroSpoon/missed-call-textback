import twilio from "twilio";
import { webhookUrl } from "@/lib/env";
import { logger } from "@/lib/logger";
import { redactPhone } from "@/lib/phone";
import {
  EMPTY_TWIML,
  forbidden,
  twimlResponse,
  verifyTwilioRequest,
} from "@/lib/twilio-signature";
import * as repo from "@/server/repo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/voice/[clientId]
 *
 * Configured as the Voice webhook on the tenant's Twilio number. Returns TwiML
 * that bridges the caller to the business's real line. Whether the call was
 * answered is decided later, by the Dial action callback.
 */
export async function POST(
  req: Request,
  ctx: { params: Promise<{ clientId: string }> },
) {
  const { clientId } = await ctx.params;

  // Signature check first, before any database access.
  const verification = await verifyTwilioRequest(req);
  if (!verification.valid) {
    logger.warn("voice.rejected", { client_id: clientId, reason: verification.reason });
    return forbidden(verification.reason);
  }
  const params = verification.params;

  const client = await repo.getClientById(clientId);
  if (!client) {
    logger.warn("voice.unknown_client", { client_id: clientId });
    return twimlResponse(
      '<?xml version="1.0" encoding="UTF-8"?><Response><Say>This number is not in service.</Say><Hangup/></Response>',
    );
  }
  if (!client.active) {
    logger.info("voice.inactive_client", { client_id: clientId });
    return twimlResponse(EMPTY_TWIML);
  }

  const response = new twilio.twiml.VoiceResponse();
  const dial = response.dial({
    timeout: client.dialTimeoutSeconds,
    action: webhookUrl(`/api/voice/status/${client.id}`),
    method: "POST",
    // Keep the caller hearing ringback instead of dead air, and keep the call
    // "unanswered" until the business actually picks up.
    answerOnBridge: true,
    // Pass the original caller's number through so the business owner sees who
    // is calling. Twilio permits this specifically when forwarding an inbound
    // call; if your carrier rejects it, swap to client.twilioNumber.
    callerId: params.From,
  });

  dial.number(
    {
      statusCallback: webhookUrl(`/api/voice/status/${client.id}?src=child`),
      statusCallbackEvent: ["initiated", "ringing", "answered", "completed"],
      statusCallbackMethod: "POST",
    },
    client.businessPhone,
  );

  logger.info("voice.dialing", {
    client_id: client.id,
    call_sid: params.CallSid,
    caller: redactPhone(params.From),
    timeout: client.dialTimeoutSeconds,
  });

  return twimlResponse(response.toString());
}
