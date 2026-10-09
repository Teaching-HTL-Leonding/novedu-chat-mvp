import { describe, expect, it } from "vitest";
import { formatConversationTime } from "@/lib/conversation-time";

// Local times throughout (the browser's zone): the dates are built with the
// local-time constructor, so the assertions hold in any zone the suite runs in.
// A fixed locale keeps the wording stable.

const LOCALE = "en-GB";
const NOW = new Date(2026, 9, 9, 15, 0); // Fri 9 Oct 2026, 15:00

describe("formatConversationTime", () => {
  it("today", () => {
    expect(formatConversationTime(new Date(2026, 9, 9, 14, 32), NOW, LOCALE)).toBe("Today, 14:32");
  });

  it("yesterday", () => {
    expect(formatConversationTime(new Date(2026, 9, 8, 9, 10), NOW, LOCALE)).toBe(
      "Yesterday, 09:10",
    );
  });

  it("midnight boundaries", () => {
    expect(formatConversationTime(new Date(2026, 9, 9, 0, 0), NOW, LOCALE)).toBe("Today, 00:00");
    expect(formatConversationTime(new Date(2026, 9, 8, 23, 59), NOW, LOCALE)).toBe(
      "Yesterday, 23:59",
    );
    expect(formatConversationTime(new Date(2026, 9, 7, 23, 59), NOW, LOCALE)).toBe(
      "Wed 7 Oct, 23:59",
    );
  });

  it("earlier this year", () => {
    expect(formatConversationTime(new Date(2026, 9, 5, 11, 5), NOW, LOCALE)).toBe(
      "Mon 5 Oct, 11:05",
    );
  });

  it("an older year", () => {
    expect(formatConversationTime(new Date(2025, 9, 6, 11, 5), NOW, LOCALE)).toBe(
      "6 Oct 2025, 11:05",
    );
  });

  it("yesterday across a year boundary", () => {
    expect(
      formatConversationTime(new Date(2025, 11, 31, 20, 0), new Date(2026, 0, 1, 8, 0), LOCALE),
    ).toBe("Yesterday, 20:00");
  });
});
