import crypto from "node:crypto";
import type { Call, Client } from "@/db/schema";

export const AUTH_TOKEN = "test_auth_token";
export const APP_URL = "https://example.test";

/**
 * Twilio's signature algorithm: HMAC-SHA1 over the full URL followed by every
 * POST parameter, sorted by key and concatenated as key+value.
 * Reimplemented here so the tests sign requests the way Twilio really does,
 * rather than trusting the library we are testing against.
 */
export function signTwilioRequest(
  url: string,
  params: Record<string, string>,
  authToken = AUTH_TOKEN,
): string {
  const data = Object.keys(params)
    .sort()
    .reduce((acc, key) => acc + key + params[key], url);
  return crypto.createHmac("sha1", authToken).update(Buffer.from(data, "utf-8")).digest("base64");
}

export interface WebhookRequestOptions {
  path: string;
  params: Record<string, string>;
  /** Omit for a correctly signed request; pass a string to forge one. */
  signature?: string;
}

export function twilioRequest({ path, params, signature }: WebhookRequestOptions): Request {
  const url = `${APP_URL}${path}`;
  const body = new URLSearchParams(params).toString();

  return new Request(url, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      "x-twilio-signature": signature ?? signTwilioRequest(url, params),
      host: "example.test",
      "x-forwarded-proto": "https",
    },
    body,
  });
}

export function routeContext(clientId: string) {
  return { params: Promise.resolve({ clientId }) };
}

export const CLIENT_ID = "11111111-1111-4111-8111-111111111111";
export const CALL_ID = "22222222-2222-4222-8222-222222222222";

export function makeClient(overrides: Partial<Client> = {}): Client {
  return {
    id: CLIENT_ID,
    name: "Demo Plumbing Co",
    businessPhone: "+15551230000",
    twilioNumber: "+15559990000",
    twilioNumberSid: "PNtest",
    timezone: "America/New_York",
    dialTimeoutSeconds: 20,
    quietHoursEnabled: true,
    quietHoursStart: "21:00",
    quietHoursEnd: "08:00",
    active: true,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    ...overrides,
  };
}

export function makeCall(overrides: Partial<Call> = {}): Call {
  return {
    id: CALL_ID,
    clientId: CLIENT_ID,
    twilioCallSid: "CAtest0000000000000000000000000001",
    fromNumber: "+15558887777",
    toNumber: "+15559990000",
    status: "no-answer",
    durationSeconds: 0,
    missed: true,
    suppressed: false,
    suppressionReason: null,
    smsSent: false,
    createdAt: new Date("2026-06-15T15:00:00Z"),
    ...overrides,
  };
}

/** A missed-call status callback payload as Twilio sends it. */
export function missedCallParams(overrides: Record<string, string> = {}) {
  return {
    CallSid: "CAtest0000000000000000000000000001",
    AccountSid: "ACtest00000000000000000000000000",
    From: "+15558887777",
    To: "+15559990000",
    CallStatus: "completed",
    DialCallStatus: "no-answer",
    DialCallDuration: "0",
    ...overrides,
  };
}
