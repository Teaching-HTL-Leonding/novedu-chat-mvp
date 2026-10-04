// @vitest-environment node
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

// The start page's shell: who gets which sections, in which order. The data
// sections are stubbed (they have their own tests in app/_home/).

const getSession = vi.hoisted(() => vi.fn());
vi.mock("@/lib/session", () => ({ getSession }));
// The effective role (docs/auth.md): a real teacher outside view-as-student mode.
const effectiveTeacherForSession = vi.hoisted(() => vi.fn());
vi.mock("@/lib/student-mode", () => ({ effectiveTeacherForSession }));
vi.mock("./code-entry", () => ({ CodeEntryForm: () => <form data-testid="code-form" /> }));
vi.mock("./_home/recent-list", () => ({
  RecentList: () => <div data-testid="recent" />,
  RecentListSkeleton: () => null,
}));
vi.mock("./_home/news-strip", () => ({ NewsStrip: () => <div data-testid="news" /> }));
vi.mock("./_home/progress-section", () => ({
  ProgressSection: () => <div data-testid="progress" />,
  ProgressSkeleton: () => null,
}));
vi.mock("./_home/calendar-section", () => ({
  CalendarSection: () => <div data-testid="calendar" />,
  CalendarSkeleton: () => null,
}));
vi.mock("./_home/refresh-section", () => ({
  RefreshSection: () => <div data-testid="refresh" />,
  RefreshSkeleton: () => null,
}));
vi.mock("./_home/almost-there-section", () => ({
  AlmostThereSection: () => <div data-testid="almost" />,
  AlmostThereSkeleton: () => null,
}));
vi.mock("./_home/badges-section", () => ({
  BadgesSection: () => <div data-testid="badges" />,
  BadgesSkeleton: () => null,
}));
vi.mock("./_home/teacher-header", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./_home/teacher-header")>()),
  TeacherIntroNote: () => <p data-testid="intro" />,
}));
vi.mock("./_home/attention-section", () => ({
  AttentionSection: () => <div data-testid="attention" />,
  AttentionSkeleton: () => null,
}));
vi.mock("./_home/teacher-kpi-section", () => ({
  TeacherKpiSection: () => <div data-testid="kpis" />,
  TeacherKpiSkeleton: () => null,
}));
vi.mock("./_home/top-activities-section", () => ({
  TopActivitiesSection: () => <div data-testid="top" />,
  TopActivitiesSkeleton: () => null,
}));

import Home from "./page";

const order = (html: string) => [...html.matchAll(/data-testid="([^"]+)"/g)].map((m) => m[1]);

beforeEach(() => {
  vi.clearAllMocks();
  effectiveTeacherForSession.mockResolvedValue(false);
});

describe("start page", () => {
  it("a student gets Continue first, then the strip, progress, calendar, Time to refresh, Almost there and badges", async () => {
    getSession.mockResolvedValue({ user: { id: "s1", name: "Lena Gruber", isTeacher: false } });
    const html = renderToStaticMarkup(await Home());
    expect(html).toContain("Welcome back, Lena");
    expect(order(html)).toEqual([
      "code-form",
      "recent",
      "news",
      "progress",
      "calendar",
      "refresh",
      "almost",
      "badges",
    ]);
  });

  it("a teacher gets the dashboard: header with the Teacher Guide, attention bar, KPIs, top activities", async () => {
    getSession.mockResolvedValue({ user: { id: "t1", name: "Rainer Stropek", isTeacher: true } });
    effectiveTeacherForSession.mockResolvedValue(true);
    const html = renderToStaticMarkup(await Home());
    expect(html).toContain("Welcome back, Rainer");
    expect(html).toContain('href="https://docs.novedu.at"');
    expect(order(html)).toEqual(["intro", "attention", "kpis", "top"]);
    // No code entry, no Recently used, no student progress.
    expect(html).not.toContain("code-form");
    expect(html).not.toContain("Your progress");
  });

  it("a teacher in view-as-student mode gets the student shell from their own usage", async () => {
    getSession.mockResolvedValue({ user: { id: "t1", name: "Rainer Stropek", isTeacher: true } });
    effectiveTeacherForSession.mockResolvedValue(false);
    const html = renderToStaticMarkup(await Home());
    expect(html).toContain("Welcome back, Rainer");
    expect(order(html)).toEqual([
      "code-form",
      "recent",
      "news",
      "progress",
      "calendar",
      "refresh",
      "almost",
      "badges",
    ]);
  });

  it("without a resolvable session only the code field is offered", async () => {
    getSession.mockResolvedValue(null);
    const html = renderToStaticMarkup(await Home());
    expect(html).toContain("Enter your code");
    expect(order(html)).toEqual(["code-form"]);
  });

  it("greets without a name when the account has none", async () => {
    getSession.mockResolvedValue({ user: { id: "s2", name: "", isTeacher: false } });
    expect(renderToStaticMarkup(await Home())).toContain(">Welcome back<");
  });
});
