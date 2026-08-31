import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  CLIENT_ID,
  makeCall,
  makeClient,
  missedCallParams,
  routeContext,
  signTwilioRequest,
  twilioRequest,
} from "./helpers";

const repo = vi.hoisted(() => ({
  getClientById: vi.fn(),
  insertCallIfNew: vi.fn(),
  updateCallById: vi.fn(),
  isOptedOut: vi.fn(),
  getDefaultTemplate: vi.fn(),
  insertMessage: vi.fn(),
  getCachedLookup: vi.fn(),
  saveLookup: vi.fn(),
  findRecentMissedCall: vi.fn(),
  addOptOut: vi.fn(),
  removeOptOut: vi.fn(),
  updateMessageStatus: vi.fn(),
  updateCallBySid: vi.fn(),
}));

const twilioLib = vi.hoisted(() => ({
  sendSms: vi.fn(),
  lookupLineType: vi.fn(),
}));

vi.mock("@/server/repo", () => repo);
vi.mock("@/lib/twilio", () => twilioLib);

const { POST: voiceStatusPost } = await import("@/app/api/voice/status/[clientId]/route");
const { POST: voicePost } = await import("@/app/api/voice/[clientId]/route");
const { POST: smsIncomingPost } = await import("@/app/api/sms/incoming/[clientId]/route");
const { POST: smsStatusPost } = await import("@/app/api/sms/status/route");

describe("X-Twilio-Signature validation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    repo.getClientById.mockResolvedValue(makeClient());
    repo.insertCallIfNew.mockResolvedValue(makeCall());
    repo.isOptedOut.mockResolvedValue(false);
    repo.getDefaultTemplate.mockResolvedValue({ body: "Sorry we missed you." });
    repo.getCachedLookup.mockResolvedValue({
      isMobile: true,
      checkedAt: new Date(),
    });
    twilioLib.sendSms.mockResolvedValue({ sid: "SMtest", status: "queued" });
  });

  it("rejects a forged signature with 403 and writes nothing", async () => {
    const params = missedCallParams();
    const request = twilioRequest({
      path: `/api/voice/status/${CLIENT_ID}`,
      params,
      signature: "obviously-not-a-real-signature",
    });

    const response = await voiceStatusPost(request, routeContext(CLIENT_ID));

    expect(response.status).toBe(403);
    expect(repo.getClientById).not.toHaveBeenCalled();
    expect(repo.insertCallIfNew).not.toHaveBeenCalled();
    expect(twilioLib.sendSms).not.toHaveBeenCalled();
  });

  it("rejects a request with no signature header at all", async () => {
    const url = `https://example.test/api/voice/status/${CLIENT_ID}`;
    const request = new Request(url, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(missedCallParams()).toString(),
    });

    const response = await voiceStatusPost(request, routeContext(CLIENT_ID));

    expect(response.status).toBe(403);
    expect(repo.insertCallIfNew).not.toHaveBeenCalled();
  });

  it("rejects a signature that was valid for different parameters", async () => {
    // Replaying a real signature against a tampered body must fail: this is the
    // attack the header actually defends against.
    const path = `/api/voice/status/${CLIENT_ID}`;
    const original = missedCallParams();
    const signature = signTwilioRequest(`https://example.test${path}`, original);

    const tampered = missedCallParams({ From: "+15550001111" });
    const request = twilioRequest({ path, params: tampered, signature });

    const response = await voiceStatusPost(request, routeContext(CLIENT_ID));

    expect(response.status).toBe(403);
    expect(repo.insertCallIfNew).not.toHaveBeenCalled();
  });

  it("accepts a correctly signed request", async () => {
    const request = twilioRequest({
      path: `/api/voice/status/${CLIENT_ID}`,
      params: missedCallParams(),
    });

    const response = await voiceStatusPost(request, routeContext(CLIENT_ID));

    expect(response.status).toBe(200);
    expect(repo.insertCallIfNew).toHaveBeenCalledOnce();
  });

  it("is enforced on every Twilio webhook, not just the status callback", async () => {
    const forged = "nope";

    const voice = await voicePost(
      twilioRequest({
        path: `/api/voice/${CLIENT_ID}`,
        params: { CallSid: "CA1", From: "+15558887777", To: "+15559990000" },
        signature: forged,
      }),
      routeContext(CLIENT_ID),
    );

    const smsIn = await smsIncomingPost(
      twilioRequest({
        path: `/api/sms/incoming/${CLIENT_ID}`,
        params: { MessageSid: "SM1", From: "+15558887777", Body: "hello" },
        signature: forged,
      }),
      routeContext(CLIENT_ID),
    );

    const smsStatus = await smsStatusPost(
      twilioRequest({
        path: "/api/sms/status",
        params: { MessageSid: "SM1", MessageStatus: "delivered" },
        signature: forged,
      }),
    );

    expect(voice.status).toBe(403);
    expect(smsIn.status).toBe(403);
    expect(smsStatus.status).toBe(403);
    expect(repo.getClientById).not.toHaveBeenCalled();
    expect(repo.insertMessage).not.toHaveBeenCalled();
  });
});
