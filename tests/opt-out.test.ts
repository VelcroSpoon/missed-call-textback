import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CALL_ID,
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
  addOptOut: vi.fn(),
  removeOptOut: vi.fn(),
  getDefaultTemplate: vi.fn(),
  insertMessage: vi.fn(),
  updateMessageStatus: vi.fn(),
  getCachedLookup: vi.fn(),
  saveLookup: vi.fn(),
  findRecentMissedCall: vi.fn(),
}));

const twilioLib = vi.hoisted(() => ({
  sendSms: vi.fn(),
  lookupLineType: vi.fn(),
}));

vi.mock("@/server/repo", () => repo);
vi.mock("@/lib/twilio", () => twilioLib);

const { POST: statusPost } = await import("@/app/api/voice/status/[clientId]/route");
const { POST: smsIncomingPost } = await import("@/app/api/sms/incoming/[clientId]/route");

describe("opt-out suppression", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-06-15T19:00:00Z"));
    repo.getClientById.mockResolvedValue(makeClient());
    repo.insertCallIfNew.mockResolvedValue(makeCall());
    repo.getDefaultTemplate.mockResolvedValue({ body: "Sorry we missed your call." });
    repo.getCachedLookup.mockResolvedValue({ isMobile: true, checkedAt: new Date() });
    repo.findRecentMissedCall.mockResolvedValue(null);
    twilioLib.sendSms.mockResolvedValue({ sid: "SMtest1", status: "queued" });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("never texts a number on the client's opt-out list", async () => {
    repo.isOptedOut.mockResolvedValue(true);

    const response = await statusPost(
      twilioRequest({ path: `/api/voice/status/${CLIENT_ID}`, params: missedCallParams() }),
      routeContext(CLIENT_ID),
    );

    expect(response.status).toBe(200);
    expect(twilioLib.sendSms).not.toHaveBeenCalled();
    expect(repo.updateCallById).toHaveBeenCalledWith(
      CALL_ID,
      expect.objectContaining({ suppressed: true, suppressionReason: "opted_out", smsSent: false }),
    );
  });

  it("checks the opt-out list before paying for a Lookup", async () => {
    repo.isOptedOut.mockResolvedValue(true);

    await statusPost(
      twilioRequest({ path: `/api/voice/status/${CLIENT_ID}`, params: missedCallParams() }),
      routeContext(CLIENT_ID),
    );

    expect(repo.getCachedLookup).not.toHaveBeenCalled();
    expect(twilioLib.lookupLineType).not.toHaveBeenCalled();
  });

  it("still logs the call as missed when the text is suppressed", async () => {
    repo.isOptedOut.mockResolvedValue(true);

    await statusPost(
      twilioRequest({ path: `/api/voice/status/${CLIENT_ID}`, params: missedCallParams() }),
      routeContext(CLIENT_ID),
    );

    expect(repo.insertCallIfNew).toHaveBeenCalledWith(expect.objectContaining({ missed: true }));
  });

  it("texts normally when the caller has not opted out", async () => {
    repo.isOptedOut.mockResolvedValue(false);

    await statusPost(
      twilioRequest({ path: `/api/voice/status/${CLIENT_ID}`, params: missedCallParams() }),
      routeContext(CLIENT_ID),
    );

    expect(twilioLib.sendSms).toHaveBeenCalledOnce();
  });
});

describe("inbound opt-out keywords", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    repo.getClientById.mockResolvedValue(makeClient());
    repo.findRecentMissedCall.mockResolvedValue(null);
  });

  async function reply(body: string) {
    return smsIncomingPost(
      twilioRequest({
        path: `/api/sms/incoming/${CLIENT_ID}`,
        params: { MessageSid: "SMin1", From: "+15558887777", To: "+15559990000", Body: body },
      }),
      routeContext(CLIENT_ID),
    );
  }

  it.each(["STOP", "stop", "  Stop! ", "UNSUBSCRIBE", "STOPALL", "CANCEL", "END", "QUIT"])(
    "writes an opt-out for %j and confirms",
    async (keyword) => {
      const response = await reply(keyword);
      const xml = await response.text();

      expect(repo.addOptOut).toHaveBeenCalledWith(CLIENT_ID, "+15558887777");
      expect(xml).toContain("<Message>");
      expect(xml).toContain("unsubscribed");
    },
  );

  it.each(["START", "unstop"])("removes the opt-out for %j", async (keyword) => {
    const response = await reply(keyword);
    const xml = await response.text();

    expect(repo.removeOptOut).toHaveBeenCalledWith(CLIENT_ID, "+15558887777");
    expect(xml).toContain("resubscribed");
  });

  it("logs every inbound message, keyword or not", async () => {
    await reply("Yeah can you come out Tuesday?");

    expect(repo.insertMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        clientId: CLIENT_ID,
        direction: "inbound",
        body: "Yeah can you come out Tuesday?",
        twilioMessageSid: "SMin1",
      }),
    );
    expect(repo.addOptOut).not.toHaveBeenCalled();
    expect(repo.removeOptOut).not.toHaveBeenCalled();
  });

  it("attributes a reply to the missed call that prompted it", async () => {
    repo.findRecentMissedCall.mockResolvedValue(makeCall());

    await reply("Sure, call me back");

    expect(repo.insertMessage).toHaveBeenCalledWith(
      expect.objectContaining({ callId: CALL_ID, direction: "inbound" }),
    );
  });
});
