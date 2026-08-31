import { NextResponse } from "next/server";
import { logger } from "@/lib/logger";
import { forbidden, verifyTwilioRequest } from "@/lib/twilio-signature";
import * as repo from "@/server/repo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/sms/status
 *
 * Twilio delivery status callback. Not tenant-scoped in the URL — the
 * MessageSid already identifies the row, and the message row carries the
 * client_id.
 */
export async function POST(req: Request) {
  const verification = await verifyTwilioRequest(req);
  if (!verification.valid) {
    logger.warn("sms_status.rejected", { reason: verification.reason });
    return forbidden(verification.reason);
  }
  const params = verification.params;

  const messageSid = params.MessageSid ?? params.SmsSid;
  const status = params.MessageStatus ?? params.SmsStatus;

  if (!messageSid || !status) {
    logger.warn("sms_status.incomplete", { message_sid: messageSid, status });
    return new NextResponse(null, { status: 204 });
  }

  const rawErrorCode = Number.parseInt(params.ErrorCode ?? "", 10);
  const errorCode = Number.isFinite(rawErrorCode) ? rawErrorCode : null;

  const updated = await repo.updateMessageStatus(messageSid, status, errorCode);

  if (!updated) {
    // Status callback for a message we never recorded (e.g. a TwiML reply, or
    // a message sent from the Twilio console). Nothing to do.
    logger.debug("sms_status.unknown_message", { message_sid: messageSid, status });
  } else if (errorCode) {
    logger.warn("sms_status.delivery_error", { message_sid: messageSid, status, error_code: errorCode });
  } else {
    logger.info("sms_status.updated", { message_sid: messageSid, status });
  }

  return new NextResponse(null, { status: 204 });
}
