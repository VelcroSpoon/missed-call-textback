import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CLIENT_ID,
  makeCall,
  makeClient,
  missedCallParams,
  routeContext,
  twilioRequest,
} from "./helpers";

const repo = vi.hoisted(() => ({
  getClientById: vi.fn(),
  insertCallIfNew: vi.fn(),
  updateCallById: vi.fn(),
  updateCallBySid: vi.fn(),
  isOptedOut: vi.fn(),
  getDefaultTemplate: vi.fn(),
  insertMessage: vi.fn(),
  updateMessageStatus: vi.fn(),
  getCachedLookup: vi.fn(),
  saveLookup: vi.fn(),
  findRecentMissedCall: vi.fn(),
  addOptOut: vi.fn(),
  removeOptOut: vi.fn(),
}));

const twilioLib = vi.hoisted(() => ({
  sendSms: vi.fn(),
  lookupLineType: vi.fn(),
}));

vi.mock("@/server/repo", () => repo);
vi.mock("@/lib/twilio", () => twilioLib);

const { POST } = await import("@/app/api/voice/status/[clientId]/route");

function statusRequest(params: Record<string, string> = missedCallParams()) {
  return twilioRequest({ path: `/api/voice/status/${CLIENT_ID}`, params });
}

describe("status callback idempotency", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Freeze at mid-afternoon in New York so quiet hours never interfere.
    // Only Date is faked — timers and promises stay real.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-06-15T19:00:00Z"));
    repo.getClientById.mockResolvedValue(makeClient());
    repo.isOptedOut.mockResolvedValue(false);
    repo.getDefaultTemplate.mockResolvedValue({ body: "Sorry we missed your call." });
    repo.getCachedLookup.mockResolvedValue({ isMobile: true, checkedAt: new Date() });
    twilioLib.sendSms.mockResolvedValue({ sid: "SMtest1", status: "queued" });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("sends exactly one SMS when Twilio retries the same CallSid", async () => {
    // First delivery wins the insert; every retry conflicts and gets null back.
    repo.insertCallIfNew
      .mockResolvedValueOnce(makeCall())
      .mockResolvedValue(null);

    const first = await POST(statusRequest(), routeContext(CLIENT_ID));
    const second = await POST(statusRequest(), routeContext(CLIENT_ID));
    const third = await POST(statusRequest(), routeContext(CLIENT_ID));

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(third.status).toBe(200);

    expect(repo.insertCallIfNew).toHaveBeenCalledTimes(3);
    expect(twilioLib.sendSms).toHaveBeenCalledTimes(1);
    expect(repo.insertMessage).toHaveBeenCalledTimes(1);
  });

  it("keys idempotency on the CallSid, so a different call still sends", async () => {
    repo.insertCallIfNew
      .mockResolvedValueOnce(makeCall({ twilioCallSid: "CAaaa" }))
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(makeCall({ id: "33333333-3333-4333-8333-333333333333", twilioCallSid: "CAbbb" }));

    await POST(statusRequest(missedCallParams({ CallSid: "CAaaa" })), routeContext(CLIENT_ID));
    await POST(statusRequest(missedCallParams({ CallSid: "CAaaa" })), routeContext(CLIENT_ID));
    await POST(statusRequest(missedCallParams({ CallSid: "CAbbb" })), routeContext(CLIENT_ID));

    expect(twilioLib.sendSms).toHaveBeenCalledTimes(2);
  });

  it("does not text back when the business answered", async () => {
    repo.insertCallIfNew.mockResolvedValue(
      makeCall({ status: "completed", missed: false, durationSeconds: 42 }),
    );

    const response = await POST(
      statusRequest(missedCallParams({ DialCallStatus: "completed", DialCallDuration: "42" })),
      routeContext(CLIENT_ID),
    );

    expect(response.status).toBe(200);
    expect(repo.insertCallIfNew).toHaveBeenCalledWith(
      expect.objectContaining({ missed: false, status: "completed", durationSeconds: 42 }),
    );
    expect(twilioLib.sendSms).not.toHaveBeenCalled();
  });

  it("treats busy and failed as missed, like no-answer", async () => {
    repo.insertCallIfNew.mockImplementation(async (values: { status: string }) =>
      makeCall({ status: values.status }),
    );

    for (const status of ["no-answer", "busy", "failed"]) {
      vi.clearAllMocks();
      repo.getClientById.mockResolvedValue(makeClient());
      repo.isOptedOut.mockResolvedValue(false);
      repo.getDefaultTemplate.mockResolvedValue({ body: "Sorry we missed your call." });
      repo.getCachedLookup.mockResolvedValue({ isMobile: true, checkedAt: new Date() });
      twilioLib.sendSms.mockResolvedValue({ sid: `SM-${status}`, status: "queued" });
      repo.insertCallIfNew.mockResolvedValue(makeCall({ status }));

      await POST(
        statusRequest(missedCallParams({ DialCallStatus: status })),
        routeContext(CLIENT_ID),
      );

      expect(twilioLib.sendSms, `expected an SMS for DialCallStatus=${status}`).toHaveBeenCalledTimes(1);
    }
  });

  it("ignores per-leg statusCallbacks, which carry no DialCallStatus", async () => {
    const params = {
      CallSid: "CAchild",
      ParentCallSid: "CAtest0000000000000000000000000001",
      CallStatus: "ringing",
      From: "+15559990000",
      To: "+15551230000",
    };

    const response = await POST(
      twilioRequest({ path: `/api/voice/status/${CLIENT_ID}?src=child`, params }),
      routeContext(CLIENT_ID),
    );

    expect(response.status).toBe(200);
    // Critically: no call row is created, so the leg event cannot consume the
    // idempotency key before the real action callback arrives.
    expect(repo.insertCallIfNew).not.toHaveBeenCalled();
    expect(twilioLib.sendSms).not.toHaveBeenCalled();
  });
});
