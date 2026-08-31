import twilio from "twilio";
import { NextResponse } from "next/server";
import { env } from "./env";
import { logger } from "./logger";

/**
 * X-Twilio-Signature validation.
 *
 * Twilio computes the signature over the exact URL it requested plus the
 * POST parameters. Two things make this awkward on Vercel:
 *
 *  1. The raw body. Next's App Router gives us `req.text()`, which is the raw
 *     body — but it can only be read once, so this helper reads it and hands
 *     the parsed params back to the route. Routes must never call req.formData()
 *     themselves.
 *  2. The URL. Behind Vercel's proxy `req.url` is often an internal origin, so
 *     we rebuild the signed URL from APP_URL and also try the forwarded host,
 *     accepting the request if any candidate validates.
 */

export type TwilioParams = Record<string, string>;

export type TwilioVerification =
  | { valid: true; params: TwilioParams }
  | { valid: false; params: null; reason: string };

function candidateUrls(req: Request): string[] {
  const parsed = new URL(req.url);
  const pathAndQuery = `${parsed.pathname}${parsed.search}`;
  const candidates: string[] = [];

  const configured = process.env.APP_URL?.replace(/\/+$/, "");
  if (configured) candidates.push(`${configured}${pathAndQuery}`);

  const forwardedHost = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  const forwardedProto = req.headers.get("x-forwarded-proto") ?? "https";
  if (forwardedHost) candidates.push(`${forwardedProto}://${forwardedHost}${pathAndQuery}`);

  candidates.push(req.url);
  return Array.from(new Set(candidates));
}

function parseBody(rawBody: string): TwilioParams {
  const params: TwilioParams = {};
  for (const [key, value] of new URLSearchParams(rawBody)) params[key] = value;
  return params;
}

/**
 * Reads the raw body, validates the signature, and returns the parsed params.
 * Call this as the very first thing in every Twilio webhook, before any DB
 * write or outbound API call.
 */
export async function verifyTwilioRequest(req: Request): Promise<TwilioVerification> {
  const rawBody = await req.text();
  const params = parseBody(rawBody);

  if (env.skipSignatureValidation) {
    logger.warn("twilio.signature.skipped", { path: new URL(req.url).pathname });
    return { valid: true, params };
  }

  const signature = req.headers.get("x-twilio-signature");
  if (!signature) return { valid: false, params: null, reason: "missing_signature_header" };

  const authToken = process.env.TWILIO_AUTH_TOKEN;
  if (!authToken) {
    // Misconfiguration, not an attack — but we still must not process it.
    logger.error("twilio.signature.no_auth_token");
    return { valid: false, params: null, reason: "missing_auth_token" };
  }

  for (const url of candidateUrls(req)) {
    if (twilio.validateRequest(authToken, signature, url, params)) {
      return { valid: true, params };
    }
  }

  logger.warn("twilio.signature.invalid", {
    path: new URL(req.url).pathname,
    candidates: candidateUrls(req).length,
  });
  return { valid: false, params: null, reason: "invalid_signature" };
}

/** The 403 every webhook returns on a failed signature check. */
export function forbidden(reason: string): NextResponse {
  return new NextResponse("Forbidden", {
    status: 403,
    headers: { "content-type": "text/plain; charset=utf-8", "x-rejection-reason": reason },
  });
}

/** Standard TwiML response wrapper. */
export function twimlResponse(body: string): NextResponse {
  return new NextResponse(body, {
    status: 200,
    headers: { "content-type": "text/xml; charset=utf-8" },
  });
}

export const EMPTY_TWIML = '<?xml version="1.0" encoding="UTF-8"?><Response/>';
