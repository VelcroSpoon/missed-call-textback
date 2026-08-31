import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isQuietHours, parseTimeOfDay } from "@/lib/quiet-hours";
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

const { POST } = await import("@/app/api/voice/status/[clientId]/route");

const NY = {
  timezone: "America/New_York",
  quietHoursEnabled: true,
  quietHoursStart: "21:00",
  quietHoursEnd: "08:00",
};

describe("isQuietHours", () => {
  it("parses HH:MM into minutes and rejects nonsense", () => {
    expect(parseTimeOfDay("21:00")).toBe(1260);
    expect(parseTimeOfDay("08:30")).toBe(510);
    expect(parseTimeOfDay("24:00")).toBeNull();
    expect(parseTimeOfDay("not a time")).toBeNull();
  });

  it("treats a window that wraps midnight as one continuous span", () => {
    // 02:00 in New York = 06:00 UTC (EDT, June).
    expect(isQuietHours(new Date("2026-06-15T06:00:00Z"), NY)).toBe(true);
    // 22:00 New York = 02:00 UTC the next day.
    expect(isQuietHours(new Date("2026-06-16T02:00:00Z"), NY)).toBe(true);
    // 15:00 New York = 19:00 UTC.
    expect(isQuietHours(new Date("2026-06-15T19:00:00Z"), NY)).toBe(false);
  });

  it("is inclusive of the start and exclusive of the end", () => {
    // 21:00 New York exactly = 01:00 UTC.
    expect(isQuietHours(new Date("2026-06-16T01:00:00Z"), NY)).toBe(true);
    // 08:00 New York exactly = 12:00 UTC — the window is over.
    expect(isQuietHours(new Date("2026-06-15T12:00:00Z"), NY)).toBe(false);
  });

  it("evaluates in the client's timezone, not the server's", () => {
    // 2026-06-15T06:00Z is 02:00 in New York (quiet) but 15:00 in Tokyo (not).
    const at = new Date("2026-06-15T06:00:00Z");
    expect(isQuietHours(at, NY)).toBe(true);
    expect(isQuietHours(at, { ...NY, timezone: "Asia/Tokyo" })).toBe(false);
  });

  it("respects daylight saving", () => {
    // 06:00 UTC is 01:00 EST in January (quiet) and 02:00 EDT in June (quiet),
    // but 12:30 UTC is 07:30 EST in January (quiet) and 08:30 EDT in June (not).
    expect(isQuietHours(new Date("2026-01-15T12:30:00Z"), NY)).toBe(true);
    expect(isQuietHours(new Date("2026-06-15T12:30:00Z"), NY)).toBe(false);
  });

  it("is off entirely when disabled", () => {
    expect(isQuietHours(new Date("2026-06-15T06:00:00Z"), { ...NY, quietHoursEnabled: false })).toBe(
      false,
    );
  });

  it("fails open on a broken configuration rather than muting the client", () => {
    expect(isQuietHours(new Date("2026-06-15T06:00:00Z"), { ...NY, timezone: "Not/AZone" })).toBe(
      false,
    );
    expect(isQuietHours(new Date("2026-06-15T06:00:00Z"), { ...NY, quietHoursStart: "" })).toBe(
      false,
    );
    // Start === end is "never quiet", not "always quiet".
    expect(
      isQuietHours(new Date("2026-06-15T06:00:00Z"), {
        ...NY,
        quietHoursStart: "09:00",
        quietHoursEnd: "09:00",
      }),
    ).toBe(false);
  });

  it("handles a same-day window that does not wrap", () => {
    const lunch = { ...NY, quietHoursStart: "12:00", quietHoursEnd: "13:00" };
    // 12:30 New York = 16:30 UTC in June.
    expect(isQuietHours(new Date("2026-06-15T16:30:00Z"), lunch)).toBe(true);
    expect(isQuietHours(new Date("2026-06-15T19:00:00Z"), lunch)).toBe(false);
  });
});

describe("quiet-hours suppression in the status callback", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ toFake: ["Date"] });
    repo.getClientById.mockResolvedValue(makeClient());
    repo.insertCallIfNew.mockResolvedValue(makeCall());
    repo.isOptedOut.mockResolvedValue(false);
    repo.getDefaultTemplate.mockResolvedValue({ body: "Sorry we missed your call." });
    repo.getCachedLookup.mockResolvedValue({ isMobile: true, checkedAt: new Date() });
    twilioLib.sendSms.mockResolvedValue({ sid: "SMtest1", status: "queued" });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  async function post() {
    return POST(
      twilioRequest({ path: `/api/voice/status/${CLIENT_ID}`, params: missedCallParams() }),
      routeContext(CLIENT_ID),
    );
  }

  it("suppresses the text at 2am local and logs the call as missed", async () => {
    vi.setSystemTime(new Date("2026-06-15T06:00:00Z")); // 02:00 in New York

    const response = await post();

    expect(response.status).toBe(200);
    expect(twilioLib.sendSms).not.toHaveBeenCalled();
    expect(repo.insertCallIfNew).toHaveBeenCalledWith(expect.objectContaining({ missed: true }));
    expect(repo.updateCallById).toHaveBeenCalledWith(
      CALL_ID,
      expect.objectContaining({
        suppressed: true,
        suppressionReason: "quiet_hours",
        smsSent: false,
      }),
    );
  });

  it("does not queue the suppressed message for later", async () => {
    vi.setSystemTime(new Date("2026-06-15T06:00:00Z"));

    await post();

    // Nothing outbound is written at all — no pending row to drain later.
    expect(repo.insertMessage).not.toHaveBeenCalled();
  });

  it("skips the Lookup during quiet hours", async () => {
    vi.setSystemTime(new Date("2026-06-15T06:00:00Z"));

    await post();

    expect(repo.getCachedLookup).not.toHaveBeenCalled();
    expect(twilioLib.lookupLineType).not.toHaveBeenCalled();
  });

  it("sends normally once the window has passed", async () => {
    vi.setSystemTime(new Date("2026-06-15T19:00:00Z")); // 15:00 in New York

    await post();

    expect(twilioLib.sendSms).toHaveBeenCalledOnce();
  });

  it("sends at 2am when the client has quiet hours turned off", async () => {
    vi.setSystemTime(new Date("2026-06-15T06:00:00Z"));
    repo.getClientById.mockResolvedValue(makeClient({ quietHoursEnabled: false }));

    await post();

    expect(twilioLib.sendSms).toHaveBeenCalledOnce();
  });
});

describe("landline suppression", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-06-15T19:00:00Z"));
    repo.getClientById.mockResolvedValue(makeClient());
    repo.insertCallIfNew.mockResolvedValue(makeCall());
    repo.isOptedOut.mockResolvedValue(false);
    repo.getDefaultTemplate.mockResolvedValue({ body: "Sorry we missed your call." });
    twilioLib.sendSms.mockResolvedValue({ sid: "SMtest1", status: "queued" });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  async function post() {
    return POST(
      twilioRequest({ path: `/api/voice/status/${CLIENT_ID}`, params: missedCallParams() }),
      routeContext(CLIENT_ID),
    );
  }

  it("does not text a known landline", async () => {
    repo.getCachedLookup.mockResolvedValue({ isMobile: false, checkedAt: new Date() });

    await post();

    expect(twilioLib.sendSms).not.toHaveBeenCalled();
    expect(repo.updateCallById).toHaveBeenCalledWith(
      CALL_ID,
      expect.objectContaining({ suppressed: true, suppressionReason: "not_mobile" }),
    );
  });

  it("uses the cache instead of calling Lookup again", async () => {
    repo.getCachedLookup.mockResolvedValue({ isMobile: true, checkedAt: new Date() });

    await post();

    expect(twilioLib.lookupLineType).not.toHaveBeenCalled();
    expect(twilioLib.sendSms).toHaveBeenCalledOnce();
  });

  it("calls Lookup on a cache miss and stores the result", async () => {
    repo.getCachedLookup.mockResolvedValue(null);
    twilioLib.lookupLineType.mockResolvedValue({
      isMobile: true,
      lineType: "mobile",
      carrier: "Test Mobile",
    });

    await post();

    expect(twilioLib.lookupLineType).toHaveBeenCalledWith("+15558887777");
    expect(repo.saveLookup).toHaveBeenCalledWith(
      expect.objectContaining({ phoneNumber: "+15558887777", isMobile: true }),
    );
    expect(twilioLib.sendSms).toHaveBeenCalledOnce();
  });

  it("fails open and still sends when the Lookup API errors", async () => {
    repo.getCachedLookup.mockResolvedValue(null);
    twilioLib.lookupLineType.mockRejectedValue(new Error("Twilio is down"));

    await post();

    expect(twilioLib.sendSms).toHaveBeenCalledOnce();
  });
});
