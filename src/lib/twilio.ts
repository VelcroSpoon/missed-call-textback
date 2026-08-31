import twilio from "twilio";
import { env } from "./env";

declare global {
  // eslint-disable-next-line no-var
  var __mctb_twilio: ReturnType<typeof twilio> | undefined;
}

/**
 * REST client. Prefers an API key pair when configured (revocable, scoped);
 * falls back to the account SID + auth token.
 *
 * Note that signature validation always uses the *auth token* regardless —
 * Twilio signs webhooks with the account auth token, not with API keys.
 */
export function twilioClient() {
  if (globalThis.__mctb_twilio) return globalThis.__mctb_twilio;

  const accountSid = env.twilioAccountSid;
  const keySid = env.twilioApiKeySid;
  const keySecret = env.twilioApiKeySecret;

  const client =
    keySid && keySecret
      ? twilio(keySid, keySecret, { accountSid })
      : twilio(accountSid, env.twilioAuthToken);

  globalThis.__mctb_twilio = client;
  return client;
}

export type LineTypeResult = {
  isMobile: boolean | null;
  lineType: string | null;
  carrier: string | null;
};

/**
 * Twilio Lookup v2 with the line_type_intelligence package.
 *
 * Returns isMobile:null when the lookup fails or the carrier does not report a
 * type — callers treat null as "send anyway" rather than blocking a real lead
 * on an API hiccup.
 */
export async function lookupLineType(phoneNumber: string): Promise<LineTypeResult> {
  const result = await twilioClient()
    .lookups.v2.phoneNumbers(phoneNumber)
    .fetch({ fields: "line_type_intelligence" });

  const lti = (result.lineTypeIntelligence ?? null) as {
    type?: string | null;
    carrier_name?: string | null;
  } | null;

  const type = lti?.type ?? null;
  if (!type) return { isMobile: null, lineType: null, carrier: lti?.carrier_name ?? null };

  // Twilio types: landline, mobile, fixedVoip, nonFixedVoip, personal,
  // tollFree, premium, sharedCost, uan, voicemail, pager, unknown.
  // VoIP numbers frequently do receive SMS (Google Voice, most softphones), so
  // they are treated as sendable. Only landline and pager are hard blocks.
  const NON_SMS = new Set(["landline", "pager"]);
  return {
    isMobile: NON_SMS.has(type) ? false : true,
    lineType: type,
    carrier: lti?.carrier_name ?? null,
  };
}

export interface SendSmsInput {
  to: string;
  from: string;
  body: string;
  statusCallback: string;
}

/**
 * Send an SMS.
 *
 * `from` is always the tenant's own Twilio number — in a multi-tenant setup the
 * caller must see the number they dialled, so we never let a Messaging Service
 * pick a sender from its pool. When a Messaging Service is configured we pass
 * it alongside `from`: Twilio then sends from our number while still applying
 * the service's A2P 10DLC campaign registration.
 */
export async function sendSms(input: SendSmsInput) {
  const messagingServiceSid = env.twilioMessagingServiceSid;
  return twilioClient().messages.create({
    to: input.to,
    from: input.from,
    body: input.body,
    statusCallback: input.statusCallback,
    ...(messagingServiceSid ? { messagingServiceSid } : {}),
  });
}
