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
// The shared sections name the audience they were given (the student's by default).
vi.mock("./_home/news-strip", () => ({
  NewsStrip: ({ audience = "student" }: { audience?: string }) => (
    <div data-testid="news" data-audience={audience} />
  ),
}));
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
  BadgesSection: ({ audience = "student" }: { audience?: string }) => (
    <div data-testid="badges" data-audience={audience} />
  ),
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
    getSession.mockResolvedValue({
      user: { id: "s1", name: "Gruber Lena", givenName: "Lena", isTeacher: false },
    });
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

  it("a teacher gets the dashboard: Teacher Guide header, strip, attention bar, KPIs, top activities, badges", async () => {
    getSession.mockResolvedValue({
      user: { id: "t1", name: "Stropek Rainer", givenName: "Rainer", isTeacher: true },
    });
    effectiveTeacherForSession.mockResolvedValue(true);
    const html = renderToStaticMarkup(await Home());
    expect(html).toContain("Welcome back, Rainer");
    expect(html).toContain('href="https://docs.novedu.at"');
    expect(order(html)).toEqual(["intro", "news", "attention", "kpis", "top", "badges"]);
    // The strip and the badges are the student page's sections, fed the teacher's data.
    expect(html.match(/data-audience="teacher"/g)).toHaveLength(2);
    expect(html).not.toContain('data-audience="student"');
    // No code entry, no Recently used, no student progress.
    expect(html).not.toContain("code-form");
    expect(html).not.toContain("Your progress");
  });

  it("a teacher in view-as-student mode gets the student shell from their own usage", async () => {
    getSession.mockResolvedValue({
      user: { id: "t1", name: "Stropek Rainer", givenName: "Rainer", isTeacher: true },
    });
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
    // The student's badges and strip, never the teacher's.
    expect(html).not.toContain('data-audience="teacher"');
  });

  it("without a resolvable session only the code field is offered", async () => {
    getSession.mockResolvedValue(null);
    const html = renderToStaticMarkup(await Home());
    expect(html).toContain("Enter your code");
    expect(order(html)).toEqual(["code-form"]);
  });

  it("greets with the given name, not the first word of a surname-first display name", async () => {
    getSession.mockResolvedValue({
      user: { id: "t2", name: "Huber Anna (HUBA)", givenName: "Anna", isTeacher: true },
    });
    effectiveTeacherForSession.mockResolvedValue(true);
    const html = renderToStaticMarkup(await Home());
    expect(html).toContain("Welcome back, Anna");
    expect(html).not.toContain("Welcome back, Huber");
  });

  it("greets without a name when no given name is stored, even with a display name", async () => {
    getSession.mockResolvedValue({
      user: { id: "s2", name: "Gruber Lena", givenName: null, isTeacher: false },
    });
    expect(renderToStaticMarkup(await Home())).toContain(">Welcome back<");
  });
});
