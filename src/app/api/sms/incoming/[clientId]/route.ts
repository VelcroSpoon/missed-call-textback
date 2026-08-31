import twilio from "twilio";
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

const STOP_KEYWORDS = new Set(["STOP", "STOPALL", "UNSUBSCRIBE", "CANCEL", "END", "QUIT"]);
const START_KEYWORDS = new Set(["START", "UNSTOP"]);

/** Normalise a reply for keyword matching: trim, strip punctuation, upper. */
function keywordOf(body: string | undefined): string {
  return (body ?? "")
    .trim()
    .replace(/[^\p{L}\p{N}\s]/gu, "")
    .trim()
    .toUpperCase();
}

/**
 * POST /api/sms/incoming/[clientId]
 *
 * Configured as the Messaging webhook on the tenant's Twilio number. Logs every
 * inbound message, attributes replies back to the missed call that prompted
 * them, and handles opt-out keywords.
 *
 * Note: if Twilio's Advanced Opt-Out is enabled on the Messaging Service, the
 * carrier-level filter may intercept STOP before this webhook fires. We still
 * write our own opt_outs row when we do see it, so our suppression logic never
 * depends on Twilio's copy of that state.
 */
export async function POST(
  req: Request,
  ctx: { params: Promise<{ clientId: string }> },
) {
  const { clientId } = await ctx.params;

  const verification = await verifyTwilioRequest(req);
  if (!verification.valid) {
    logger.warn("sms_incoming.rejected", { client_id: clientId, reason: verification.reason });
    return forbidden(verification.reason);
  }
  const params = verification.params;

  const client = await repo.getClientById(clientId);
  if (!client) {
    logger.warn("sms_incoming.unknown_client", { client_id: clientId });
    return twimlResponse(EMPTY_TWIML);
  }

  const from = params.From;
  const body = params.Body ?? "";
  const keyword = keywordOf(body);

  // Attribute the reply to the missed call it is answering. This is what makes
  // the recovery-rate metric meaningful.
  const relatedCall = await repo.findRecentMissedCall(client.id, from);

  await repo.insertMessage({
    callId: relatedCall?.id ?? null,
    clientId: client.id,
    direction: "inbound",
    body,
    twilioMessageSid: params.MessageSid ?? null,
    status: "received",
  });

  logger.info("sms_incoming.logged", {
    client_id: client.id,
    message_sid: params.MessageSid,
    caller: redactPhone(from),
    matched_call: Boolean(relatedCall),
    keyword: STOP_KEYWORDS.has(keyword) || START_KEYWORDS.has(keyword) ? keyword : null,
  });

  const response = new twilio.twiml.MessagingResponse();

  if (STOP_KEYWORDS.has(keyword)) {
    await repo.addOptOut(client.id, from);
    logger.info("sms_incoming.opted_out", { client_id: client.id, caller: redactPhone(from) });

    const confirmation = `You have been unsubscribed from ${client.name} and will not receive further messages. Reply START to resubscribe.`;
    response.message(confirmation);
    await repo.insertMessage({
      callId: relatedCall?.id ?? null,
      clientId: client.id,
      direction: "outbound",
      body: confirmation,
      status: "queued",
    });
    return twimlResponse(response.toString());
  }

  if (START_KEYWORDS.has(keyword)) {
    await repo.removeOptOut(client.id, from);
    logger.info("sms_incoming.opted_in", { client_id: client.id, caller: redactPhone(from) });

    const confirmation = `You have been resubscribed to messages from ${client.name}. Reply STOP to opt out.`;
    response.message(confirmation);
    await repo.insertMessage({
      callId: relatedCall?.id ?? null,
      clientId: client.id,
      direction: "outbound",
      body: confirmation,
      status: "queued",
    });
    return twimlResponse(response.toString());
  }

  // Any other reply is a real conversation between the caller and the business.
  // We log it and stay out of the way — no auto-responder.
  return twimlResponse(EMPTY_TWIML);
}
