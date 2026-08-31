import { formatPhone } from "./phone";

/**
 * Static template rendering. Deliberately not an LLM, not an expression
 * evaluator — a whitelist of placeholders and nothing else.
 */

export const OPT_OUT_NOTICE = "Reply STOP to opt out.";

export const DEFAULT_TEMPLATE_BODY =
  "Hi, this is {{business_name}}. Sorry we missed your call! " +
  "Reply to this text and we'll get right back to you.";

export const SUPPORTED_PLACEHOLDERS = ["business_name", "caller_number"] as const;
export type Placeholder = (typeof SUPPORTED_PLACEHOLDERS)[number];

export interface TemplateVars {
  business_name: string;
  caller_number: string;
}

/**
 * Replace {{placeholder}} tokens. Unknown placeholders are left as-is so that
 * a typo is visible in the preview instead of silently vanishing.
 */
export function renderTemplate(body: string, vars: TemplateVars): string {
  return body.replace(/\{\{\s*([a-z_]+)\s*\}\}/gi, (match, name: string) => {
    const key = name.toLowerCase() as Placeholder;
    if (key === "business_name") return vars.business_name;
    if (key === "caller_number") return formatPhone(vars.caller_number);
    return match;
  });
}

/**
 * Every outbound message must carry the opt-out notice. Appended rather than
 * enforced at save time so that an older template row, a seeded template, or a
 * direct DB edit can never produce a non-compliant send.
 */
export function withOptOutNotice(body: string): string {
  const trimmed = body.trim();
  if (trimmed.toLowerCase().includes(OPT_OUT_NOTICE.toLowerCase())) return trimmed;
  return `${trimmed} ${OPT_OUT_NOTICE}`;
}

/** The full outbound body, exactly as it will be handed to Twilio. */
export function buildMessageBody(body: string, vars: TemplateVars): string {
  return withOptOutNotice(renderTemplate(body, vars));
}

/**
 * Rough segment count for the template editor. GSM-7 vs UCS-2 is approximated
 * by checking for non-GSM characters; it is a UI hint, not billing truth.
 */
export function estimateSegments(body: string): { encoding: "GSM-7" | "UCS-2"; segments: number } {
  const gsm = /^[@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !"#¤%&'()*+,\-./0-9:;<=>?¡A-ZÄÖÑÜ§¿a-zäöñüà\^{}\\\[~\]|€]*$/;
  const isGsm = gsm.test(body);
  const length = body.length;
  if (isGsm) {
    return { encoding: "GSM-7", segments: length <= 160 ? 1 : Math.ceil(length / 153) };
  }
  return { encoding: "UCS-2", segments: length <= 70 ? 1 : Math.ceil(length / 67) };
}
