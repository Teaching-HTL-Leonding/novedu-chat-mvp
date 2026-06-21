// @vitest-environment node

import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

// `app/tutor-codes/[code]/page.tsx` is the detailed-stats page. Its branching is
// the part worth pinning without infra: teacher gating, the found/unknown/error
// outcomes of `getTutorCode` (any effective teacher may view any code now — no
// ownership check), and — the privacy-relevant bit — that per-student data (the
// "Students" tile and the "Student" column) appears ONLY for a non-anonymous
// code. I/O is mocked; the component is invoked directly and its HTML rendered.
// No DB, runs in CI.

const isEffectiveTeacher = vi.hoisted(() => vi.fn());
const getTutorCode = vi.hoisted(() => vi.fn());
const getCodeStats = vi.hoisted(() => vi.fn());

vi.mock("@/lib/student-mode", () => ({ isEffectiveTeacher }));
vi.mock("@/lib/tutor-code-store", () => ({ getTutorCode }));
vi.mock("@/lib/tutor-stats-store", () => ({ getCodeStats }));
// next/link needs no router in these static renders — a plain anchor is enough.
vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

import TutorCodeStatsPage from "./page";

const CODE = "a1b2c3d4e5";

function entry(overrides: Record<string, unknown> = {}) {
  return {
    code: CODE,
    createdBy: "teacher-sub-1",
    tutorUrl: "https://example.com/t.yaml",
    validFrom: new Date("2026-06-10T10:00:00Z"),
    validUntil: new Date("2026-06-10T14:00:00Z"),
    note: "My Class",
    origin: null,
    anonymous: true,
    createdAt: new Date("2026-06-09T09:00:00Z"),
    ...overrides,
  };
}

const interaction = {
  threadId: "th1",
  firstAt: new Date("2026-06-12T10:00:00Z"),
  lastAt: new Date("2026-06-12T10:05:00Z"),
  userMessageCount: 3,
  userId: "student-sub-1",
};

async function render(code = CODE) {
  const element = await TutorCodeStatsPage({ params: Promise.resolve({ code }) });
  return renderToStaticMarkup(element);
}

beforeEach(() => {
  vi.clearAllMocks();
  isEffectiveTeacher.mockResolvedValue(true);
});

describe("gating", () => {
  it("denies a non-teacher", async () => {
    isEffectiveTeacher.mockResolvedValue(false);
    const html = await render();
    expect(html).toContain("Access denied");
    expect(getTutorCode).not.toHaveBeenCalled();
  });

  it("shows a transient notice when the lookup fails", async () => {
    getTutorCode.mockResolvedValue(undefined);
    const html = await render();
    expect(html).toContain("Stats temporarily unavailable");
  });

  it("shows 'not found' for an unknown code", async () => {
    getTutorCode.mockResolvedValue(null);
    const html = await render();
    expect(html).toContain("Tutor code not found");
  });

  it("shows a transient notice when stats fail to load", async () => {
    getTutorCode.mockResolvedValue(entry());
    getCodeStats.mockResolvedValue(undefined);
    const html = await render();
    expect(html).toContain("Stats temporarily unavailable");
  });
});

describe("anonymous code", () => {
  beforeEach(() => {
    getTutorCode.mockResolvedValue(entry({ anonymous: true }));
    getCodeStats.mockResolvedValue({
      conversations: 1,
      studentCount: 0,
      interactions: [interaction],
    });
  });

  it("shows the conversation count and the interaction, but no per-student data", async () => {
    const html = await render();
    expect(html).toContain("Conversations");
    expect(html).toContain("My Class");
    // The interaction's user-message count is shown…
    expect(html).toContain(">3<");
    // …its View link points at the conversation viewer…
    expect(html).toContain(`/tutor-codes/${CODE}/c/th1`);
    // …but the privacy-gated bits are absent for an anonymous tutor.
    expect(html).not.toContain("Students");
    expect(html).not.toContain(">Student<");
    expect(html).not.toContain("student-sub-1");
  });

  it("forwards the frozen anonymous flag so the store redacts ids", async () => {
    await render();
    expect(getCodeStats).toHaveBeenCalledWith(CODE, true);
  });
});

describe("non-anonymous code", () => {
  beforeEach(() => {
    getTutorCode.mockResolvedValue(entry({ anonymous: false }));
    getCodeStats.mockResolvedValue({
      conversations: 1,
      studentCount: 1,
      interactions: [interaction],
    });
  });

  it("shows the Students tile, the Student column, and the user id", async () => {
    const html = await render();
    expect(html).toContain("Students");
    expect(html).toContain(">Student<");
    expect(html).toContain("student-sub-1");
  });

  it("forwards anonymous=false to the store", async () => {
    await render();
    expect(getCodeStats).toHaveBeenCalledWith(CODE, false);
  });
});

describe("empty state", () => {
  it("notes when a code has no conversations yet", async () => {
    getTutorCode.mockResolvedValue(entry());
    getCodeStats.mockResolvedValue({ conversations: 0, studentCount: 0, interactions: [] });
    const html = await render();
    expect(html).toContain("No conversations yet");
  });
});
