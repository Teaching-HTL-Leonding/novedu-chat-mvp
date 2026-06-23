// @vitest-environment node

import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

// `app/codes/[code]/page.tsx` is the detailed-stats page. Its branching is the
// part worth pinning without infra: teacher gating, the found/unknown/error
// outcomes of `getCode` (any effective teacher may view any code now — no
// ownership check), and — the privacy-relevant bit — that per-student data (the
// "Students" tile and the "Student" column) appears ONLY for a non-anonymous
// code. I/O is mocked; the component is invoked directly and its HTML rendered.
// No DB, runs in CI.

const isEffectiveTeacher = vi.hoisted(() => vi.fn());
const getCode = vi.hoisted(() => vi.fn());
const getCodeStats = vi.hoisted(() => vi.fn());

vi.mock("@/lib/student-mode", () => ({ isEffectiveTeacher }));
vi.mock("@/lib/code-store", () => ({ getCode }));
vi.mock("@/lib/code-stats-store", () => ({ getCodeStats }));
// The optional module-specific stats panel: both modules define no panel here.
vi.mock("@/lib/code-modules/registry", () => ({ codeModules: { tutor: {}, quiz: {} } }));
// next/link needs no router in these static renders — a plain anchor is enough.
vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

import CodeStatsPage from "./page";

const CODE = "a1b2c3d4e5";

function entry(overrides: Record<string, unknown> = {}) {
  return {
    code: CODE,
    module: "tutor",
    createdBy: "teacher-sub-1",
    fileUrl: "https://example.com/t.yaml",
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
  const element = await CodeStatsPage({ params: Promise.resolve({ code }) });
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
    expect(getCode).not.toHaveBeenCalled();
  });

  it("shows a transient notice when the lookup fails", async () => {
    getCode.mockResolvedValue(undefined);
    const html = await render();
    expect(html).toContain("Stats temporarily unavailable");
  });

  it("shows 'not found' for an unknown code", async () => {
    getCode.mockResolvedValue(null);
    const html = await render();
    expect(html).toContain("Code not found");
  });

  it("shows a transient notice when stats fail to load", async () => {
    getCode.mockResolvedValue(entry());
    getCodeStats.mockResolvedValue(undefined);
    const html = await render();
    expect(html).toContain("Stats temporarily unavailable");
  });
});

describe("anonymous code", () => {
  beforeEach(() => {
    getCode.mockResolvedValue(entry({ anonymous: true }));
    getCodeStats.mockResolvedValue({
      conversations: 1,
      studentCount: 0,
      interactions: [interaction],
    });
  });

  it("shows the count and the interaction, but no per-student data", async () => {
    const html = await render();
    // The tutor module's count column is labelled "Conversations".
    expect(html).toContain("Conversations");
    expect(html).toContain("My Class");
    // The interaction's user-message count is shown…
    expect(html).toContain(">3<");
    // …its View link points at the conversation viewer…
    expect(html).toContain(`/codes/${CODE}/c/th1`);
    // …but the privacy-gated bits are absent for an anonymous activity.
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
    getCode.mockResolvedValue(entry({ anonymous: false }));
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
  it("notes when a code has no interactions yet", async () => {
    getCode.mockResolvedValue(entry());
    getCodeStats.mockResolvedValue({ conversations: 0, studentCount: 0, interactions: [] });
    const html = await render();
    expect(html).toContain("Nothing yet");
  });
});
