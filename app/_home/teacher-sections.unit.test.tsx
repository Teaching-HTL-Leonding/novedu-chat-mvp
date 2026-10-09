import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

// The teacher start page's async server sections, called directly with the page
// data mocked and rendered to HTML (the app/usage/*-section.unit.test.tsx
// pattern). The data is built by the REAL pure builder from hand-made facts, so
// the sections are tested against the shape the loader really produces.

const mocks = vi.hoisted(() => ({
  getTeacherHome: vi.fn(),
  getStudentHome: vi.fn(),
  markAchievementsSeen: vi.fn(),
}));
vi.mock("@/lib/home-data", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/home-data")>()),
  getTeacherHome: mocks.getTeacherHome,
  getStudentHome: mocks.getStudentHome,
}));
vi.mock("@/lib/achievement-actions", () => ({ markAchievementsSeen: mocks.markAchievementsSeen }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: React.ComponentProps<"a">) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

import type { Grant } from "@/lib/achievements/evaluate";
import type { CodeDay, TeacherCode, TeacherFacts } from "@/lib/achievements/teacher";
import { buildTeacherHome } from "@/lib/home-data";
import { AttentionSection } from "./attention-section";
import { BadgesSection } from "./badges-section";
import { NewsStrip } from "./news-strip";
import { TeacherHeader, TeacherIntroNote } from "./teacher-header";
import { TeacherKpiSection } from "./teacher-kpi-section";
import { TopActivitiesSection } from "./top-activities-section";

const NOW = new Date("2026-10-04T17:30:00Z"); // Sun 4 Oct, 19:30 Vienna
const DAY = 86_400_000;
const at = (ms: number) => new Date(NOW.getTime() + ms);

const code = (id: string, extra: Partial<TeacherCode> = {}): TeacherCode => ({
  code: id,
  module: "quiz",
  note: `Note ${id}`,
  validFrom: null,
  validUntil: null,
  createdAt: at(-30 * DAY),
  ...extra,
});

const codeDay = (id: string, date: string, extra: Partial<CodeDay> = {}): CodeDay => ({
  code: id,
  date,
  interactions: 0,
  outsideSchool: 0,
  quizAnswers: 0,
  inputTokens: 0,
  outputTokens: 0,
  ...extra,
});

const FACTS: TeacherFacts = {
  codes: [
    code("TODAY", { validUntil: new Date("2026-10-04T21:59:00Z") }),
    code("TUESDAY", { validUntil: new Date("2026-10-06T12:00:00Z"), module: "tutor" }),
    code("UNUSED", { createdAt: at(-12 * DAY), note: "" }),
  ],
  usage: [
    codeDay("TUESDAY", "2026-10-01", {
      interactions: 1234,
      outsideSchool: 617,
      quizAnswers: 963,
      inputTokens: 2_100_000,
      outputTokens: 312_000,
    }),
    codeDay("TODAY", "2026-10-01"),
  ],
  conversations: 140,
  students: {
    total: 87,
    perCode: [{ code: "TUESDAY", count: 12, firstSeen: Array(12).fill("2026-09-10") }],
  },
  reports: { open: [{ code: "TUESDAY", open: 2 }], resolved: 3, resolvedOn: [] },
  files: { most: 2 },
};

/** A teacher without codes: every group loaded and empty. */
const NO_CODES: TeacherFacts = {
  codes: [],
  usage: [],
  conversations: 0,
  students: { total: 0, perCode: [] },
  reports: { open: [], resolved: 0, resolvedOn: [] },
  files: { most: 0 },
};

const GRANTS: Grant[] = [
  { id: "first-code", qualifiedOn: "2026-09-04", seenAt: null },
  { id: "crowd-10", qualifiedOn: "2026-09-10", seenAt: null },
  { id: "busy-100", qualifiedOn: "2026-10-01", seenAt: NOW },
];

const render = async (node: Promise<React.ReactNode>) => renderToStaticMarkup(await node);
/** The page data from facts and grants (GRANTS unless given; `undefined` = the grants failed). */
const withFacts = (facts: TeacherFacts, ...grants: [Grant[] | undefined] | []) =>
  mocks.getTeacherHome.mockResolvedValue(
    buildTeacherHome(facts, grants.length > 0 ? grants[0] : GRANTS, NOW),
  );

beforeEach(() => {
  withFacts(FACTS);
});

describe("TeacherHeader", () => {
  it("greets by first name and links the Teacher Guide in a new tab", () => {
    const html = renderToStaticMarkup(<TeacherHeader givenName="Rainer" note={null} />);
    expect(html).toContain("Welcome back, Rainer");
    expect(html).toContain('href="https://docs.novedu.at"');
    expect(html).toContain('target="_blank"');
    expect(html).toContain("(opens in a new tab)");
  });

  it("shows the getting-started line only to a teacher without any code", async () => {
    expect(await render(TeacherIntroNote({ userId: "t1" }))).toBe("");
    withFacts(NO_CODES);
    expect(await render(TeacherIntroNote({ userId: "t1" }))).toContain(
      "You haven&#x27;t shared an activity yet",
    );
    // Codes that failed to load are not "no codes".
    withFacts({ ...FACTS, codes: undefined });
    expect(await render(TeacherIntroNote({ userId: "t1" }))).toBe("");
  });
});

describe("AttentionSection", () => {
  it("shows the three counters; the first one with something in it starts open", async () => {
    const html = await render(AttentionSection({ userId: "t1" }));
    expect(html).toContain("Needs you");
    expect(html).toMatch(/aria-expanded="true"[^>]*>.*?Closing soon/);
    expect(html).toMatch(/aria-expanded="false"[^>]*>.*?Open reports/);
    expect(html).toMatch(/aria-expanded="false"[^>]*>.*?Never used/);
    // The open panel lists the closing codes, linked to their detail pages.
    expect(html).toContain('href="/codes/TODAY"');
    expect(html).toContain("Closes today 23:59");
    expect(html).toContain("Closes Tue 6 Oct 14:00");
  });

  it("a counter with nothing in it reads all clear and is no button", async () => {
    withFacts({
      ...FACTS,
      reports: { open: [], resolved: 0, resolvedOn: [] },
      codes: FACTS.codes?.map((c) => ({ ...c, validUntil: null })),
    });
    const html = await render(AttentionSection({ userId: "t1" }));
    expect(html).toContain("Nothing closes in the next 3 days");
    expect(html).toContain("No open reports");
    // Never used is the only counter with something in it, so it starts open.
    expect(html).toMatch(/aria-expanded="true"[^>]*>.*?Never used/);
    expect(html).toContain('href="/codes/UNUSED"');
    expect(html.match(/<button/g)).toHaveLength(1);
  });

  it("all clear everywhere: no counter is a button and no panel shows", async () => {
    withFacts({
      ...FACTS,
      reports: { open: [], resolved: 0, resolvedOn: [] },
      usage: [...(FACTS.usage ?? []), codeDay("UNUSED", "2026-10-02", { interactions: 1 })],
      codes: FACTS.codes?.map((c) => ({ ...c, validUntil: null })),
    });
    const html = await render(AttentionSection({ userId: "t1" }));
    expect(html).toContain("Every code has been used");
    expect(html).not.toContain("<button");
    expect(html).not.toContain('href="/codes/');
  });

  it("a counter whose group failed says so — never all clear", async () => {
    withFacts({ ...FACTS, reports: undefined });
    const html = await render(AttentionSection({ userId: "t1" }));
    expect(html).toContain("Open reports: could not be loaded");
    expect(html).not.toContain("No open reports");
  });

  it("failed codes: the section shows the unavailable note", async () => {
    withFacts({ ...FACTS, codes: undefined });
    const html = await render(AttentionSection({ userId: "t1" }));
    expect(html).toContain("could not be loaded right now");
    expect(html).not.toContain("<button");
  });

  it("renders nothing for a teacher without codes", async () => {
    withFacts(NO_CODES);
    expect(await render(AttentionSection({ userId: "t1" }))).toBe("");
  });
});

describe("TeacherKpiSection", () => {
  it("shows the six KPIs over the last 30 days, with the identified-students note", async () => {
    const html = await render(TeacherKpiSection({ userId: "t1" }));
    expect(html).toContain("Last 30 days");
    for (const [label, value] of [
      ["Live codes", "3"],
      ["Identified students", "87"],
      ["Conversations", "140"],
      ["Quiz answers", "963"],
      ["Input tokens", "2.1M"],
      ["Output tokens", "312K"],
    ]) {
      expect(html).toMatch(new RegExp(`<dt[^>]*>${label}</dt><dd[^>]*><span[^>]*>${value}`));
    }
    expect(html).toContain("Students in anonymous activities can&#x27;t be counted.");
  });

  it("a KPI whose group failed says Unavailable, never 0", async () => {
    withFacts({ ...FACTS, students: undefined, usage: undefined });
    const html = await render(TeacherKpiSection({ userId: "t1" }));
    expect(html.match(/Unavailable/g)).toHaveLength(4);
    expect(html).toMatch(/Identified students<\/dt><dd[^>]*><span[^>]*>Unavailable/);
    expect(html).toMatch(/Conversations<\/dt><dd[^>]*><span[^>]*>140/);
  });

  it("renders nothing for a teacher without codes", async () => {
    withFacts(NO_CODES);
    expect(await render(TeacherKpiSection({ userId: "t1" }))).toBe("");
  });
});

describe("TopActivitiesSection", () => {
  it("ranks the activities with kind, interactions and the share outside school hours", async () => {
    const html = await render(TopActivitiesSection({ userId: "t1" }));
    expect(html).toContain("Top activities");
    expect(html).toContain('href="/codes/TUESDAY"');
    expect(html).toContain("Note TUESDAY");
    expect(html).toContain(">Tutor<");
    expect(html).toContain("1,234");
    expect(html).toContain("50 %");
    // The idle code is not ranked.
    expect(html).not.toContain('href="/codes/TODAY"');
    // The column explains itself, and the board links to the usage dashboard.
    expect(html).toContain("What counts as outside school hours");
    expect(html).toContain("before 8:00 or from 17:00");
    expect(html).toContain('href="/usage"');
  });

  it("says so when nothing happened in the window", async () => {
    withFacts({ ...FACTS, usage: [] });
    expect(await render(TopActivitiesSection({ userId: "t1" }))).toContain(
      "No activity in the last 30 days.",
    );
  });

  it("shows the unavailable note when the usage group failed", async () => {
    withFacts({ ...FACTS, usage: undefined });
    const html = await render(TopActivitiesSection({ userId: "t1" }));
    expect(html).toContain("could not be loaded right now");
    expect(html).not.toContain("<table");
  });

  it("renders nothing for a teacher without codes", async () => {
    withFacts(NO_CODES);
    expect(await render(TopActivitiesSection({ userId: "t1" }))).toBe("");
  });
});

describe("BadgesSection (teacher)", () => {
  const teacherBadges = () => render(BadgesSection({ userId: "t1", audience: "teacher" }));

  it("reuses the student section: Reach and Authoring, earned first, the next tiers, Show all", async () => {
    const html = await teacherBadges();
    expect(mocks.getTeacherHome).toHaveBeenCalledWith("t1");
    expect(mocks.getStudentHome).not.toHaveBeenCalled();
    expect(html).toContain('aria-labelledby="home-badges"');
    expect(html).toContain("3 earned");
    expect(html).toContain('data-family="reach"');
    expect(html).toContain('data-family="authoring"');
    const shown = [...html.matchAll(/<li data-badge="([^"]+)" class="(?![^"]*hidden)/g)].map(
      (m) => m[1],
    );
    expect(shown).toEqual([
      "first-code",
      "crowd-10",
      "busy-100",
      "full-toolkit",
      "crowd-30",
      "busy-1000",
      "evergreen",
      "iterator",
      "listener",
      "homework-hit",
    ]);
    expect(html).toContain("Show all badges (2 more)");
    // The family discs carry the teacher colours.
    expect(html).toContain("bg-fam-reach");
    // Two families keep two wide columns, never the students' five-column grid.
    expect(html).toMatch(/data-columns="2" class="grid [^"]*md:grid-cols-2"/);
    expect(html).not.toContain("xl:grid-cols-5");
  });

  it("earned: the day only, no XP; unearned: the criterion and the best progress", async () => {
    const html = await teacherBadges();
    expect(html).toContain("Earned 4 Sep<");
    expect(html).not.toContain("XP");
    expect(html).toContain("30 identified students on one activity · 12 / 30");
    expect(html).toContain("Resolve 10 reports · 3 / 10");
    expect(html).toContain("Write 5 versions of one file · 2 / 5");
    // Homework Hit has no honest count: the criterion alone.
    expect(html).toContain("outside school hours (at least 50)</div>");
  });

  it("marks the new ones", async () => {
    const html = await teacherBadges();
    expect(html.match(/>New</g)).toHaveLength(2);
  });

  it("a teacher without codes still sees the badges, First Code as the first goal", async () => {
    withFacts(NO_CODES, []);
    const html = await teacherBadges();
    expect(html).toContain("0 earned");
    expect(html).toMatch(/<li data-badge="first-code"/);
    expect(html).toContain("Share your first activity");
  });

  it("failed grants: the unavailable note, never an empty list", async () => {
    withFacts(FACTS, undefined);
    const html = await teacherBadges();
    expect(html).toContain("could not be loaded right now");
    expect(html).not.toContain("data-badge");
  });

  it("no Secret note on the teacher page", async () => {
    expect(await teacherBadges()).not.toContain("Secret badges");
  });
});

describe("NewsStrip (teacher)", () => {
  const strip = () => render(NewsStrip({ userId: "t1", audience: "teacher" }));

  it("counts the teacher's new badges from the teacher data", async () => {
    const html = await strip();
    expect(mocks.getStudentHome).not.toHaveBeenCalled();
    expect(html).toContain('<b class="font-semibold">2 new badges</b>');
    expect(html).toContain('role="status"');
  });

  it("is absent when nothing is new or the grants failed", async () => {
    withFacts(
      FACTS,
      GRANTS.map((g) => ({ ...g, seenAt: NOW })),
    );
    expect(await strip()).toBe("");
    withFacts(FACTS, undefined);
    expect(await strip()).toBe("");
  });
});
