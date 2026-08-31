import { describe, expect, it } from "vitest";
import {
  buildMessageBody,
  DEFAULT_TEMPLATE_BODY,
  OPT_OUT_NOTICE,
  renderTemplate,
  withOptOutNotice,
} from "@/lib/templates";
import { evaluateSuppression } from "@/lib/suppression";
import { normalizePhone, redactPhone } from "@/lib/phone";

describe("template rendering", () => {
  it("substitutes the supported placeholders", () => {
    const out = renderTemplate("Hi from {{business_name}}, we saw {{caller_number}}.", {
      business_name: "Demo Plumbing Co",
      caller_number: "+15558887777",
    });
    expect(out).toBe("Hi from Demo Plumbing Co, we saw (555) 888-7777.");
  });

  it("leaves an unknown placeholder visible instead of silently dropping it", () => {
    const out = renderTemplate("Hello {{first_name}}", {
      business_name: "X",
      caller_number: "+15558887777",
    });
    expect(out).toBe("Hello {{first_name}}");
  });

  it("always ends outbound messages with the opt-out notice", () => {
    expect(withOptOutNotice("Sorry we missed you.")).toBe(
      `Sorry we missed you. ${OPT_OUT_NOTICE}`,
    );
    expect(buildMessageBody(DEFAULT_TEMPLATE_BODY, {
      business_name: "Demo Plumbing Co",
      caller_number: "+15558887777",
    })).toContain(OPT_OUT_NOTICE);
  });

  it("does not double up when the template already carries the notice", () => {
    const body = `Sorry we missed you. ${OPT_OUT_NOTICE}`;
    const out = withOptOutNotice(body);
    expect(out).toBe(body);
    expect(out.match(/Reply STOP to opt out\./g)).toHaveLength(1);
  });
});

describe("evaluateSuppression", () => {
  const base = { clientActive: true, optedOut: false, quietHours: false, isMobile: true };

  it("sends when nothing blocks it", () => {
    expect(evaluateSuppression(base)).toEqual({ send: true, reason: null });
  });

  it("applies the checks in priority order", () => {
    expect(
      evaluateSuppression({ ...base, clientActive: false, optedOut: true, quietHours: true }),
    ).toEqual({ send: false, reason: "inactive_client" });
    expect(evaluateSuppression({ ...base, optedOut: true, quietHours: true })).toEqual({
      send: false,
      reason: "opted_out",
    });
    expect(evaluateSuppression({ ...base, quietHours: true, isMobile: false })).toEqual({
      send: false,
      reason: "quiet_hours",
    });
  });

  it("blocks a confirmed landline but sends on an inconclusive lookup", () => {
    expect(evaluateSuppression({ ...base, isMobile: false }).send).toBe(false);
    expect(evaluateSuppression({ ...base, isMobile: null }).send).toBe(true);
  });
});

describe("phone helpers", () => {
  it("normalises common input shapes to E.164", () => {
    expect(normalizePhone("(555) 888-7777")).toBe("+15558887777");
    expect(normalizePhone("555.888.7777")).toBe("+15558887777");
    expect(normalizePhone("15558887777")).toBe("+15558887777");
    expect(normalizePhone("+44 20 7946 0958")).toBe("+442079460958");
    expect(normalizePhone("nonsense")).toBeNull();
    expect(normalizePhone("")).toBeNull();
  });

  it("never returns a full number from the log redactor", () => {
    expect(redactPhone("+15558887777")).toBe("+155***7777");
    expect(redactPhone(null)).toBe("<none>");
  });
});
