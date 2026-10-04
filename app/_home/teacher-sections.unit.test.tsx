// @vitest-environment node
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

// The teacher start page's async server sections, called directly with the page
// data mocked and rendered to HTML (the app/usage/*-section.unit.test.tsx
// pattern). The data is built by the REAL pure builder from hand-made facts, so
// the sections are tested against the shape the loader really produces.

const mocks = vi.hoisted(() => ({ getTeacherHome: vi.fn() }));
vi.mock("@/lib/home-data", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/home-data")>()),
  getTeacherHome: mocks.getTeacherHome,
}));
vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: React.ComponentProps<"a">) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

import type { TeacherCode, TeacherFacts } from "@/lib/achievements/teacher";
import { buildTeacherHome } from "@/lib/home-data";
import { AttentionSection } from "./attention-section";
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

const FACTS: TeacherFacts = {
  codes: [
    code("TODAY", { validUntil: new Date("2026-10-04T21:59:00Z") }),
    code("TUESDAY", { validUntil: new Date("2026-10-06T12:00:00Z"), module: "tutor" }),
    code("UNUSED", { createdAt: at(-12 * DAY), note: "" }),
  ],
  usage: [
    {
      code: "TUESDAY",
      interactions: 1234,
      outsideSchool: 617,
      quizAnswers: 963,
      inputTokens: 2_100_000,
      outputTokens: 312_000,
    },
    {
      code: "TODAY",
      interactions: 0,
      outsideSchool: 0,
      quizAnswers: 0,
      inputTokens: 0,
      outputTokens: 0,
    },
  ],
  conversations: 140,
  students: 87,
  reports: [{ code: "TUESDAY", open: 2 }],
};

const render = async (node: Promise<React.ReactNode>) => renderToStaticMarkup(await node);
const withFacts = (facts: TeacherFacts) =>
  mocks.getTeacherHome.mockResolvedValue(buildTeacherHome(facts, NOW));

beforeEach(() => {
  vi.clearAllMocks();
  withFacts(FACTS);
});

describe("TeacherHeader", () => {
  it("greets by first name and links the Teacher Guide in a new tab", () => {
    const html = renderToStaticMarkup(<TeacherHeader firstName="Rainer" note={null} />);
    expect(html).toContain("Welcome back, Rainer");
    expect(html).toContain('href="https://docs.novedu.at"');
    expect(html).toContain('target="_blank"');
    expect(html).toContain("(opens in a new tab)");
  });

  it("shows the getting-started line only to a teacher without any code", async () => {
    expect(await render(TeacherIntroNote({ userId: "t1" }))).toBe("");
    withFacts({ codes: [], usage: [], conversations: 0, students: 0, reports: [] });
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
      reports: [],
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
      reports: [],
      usage: [
        ...(FACTS.usage ?? []),
        {
          code: "UNUSED",
          interactions: 1,
          outsideSchool: 0,
          quizAnswers: 0,
          inputTokens: 0,
          outputTokens: 0,
        },
      ],
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
    withFacts({ codes: [], usage: [], conversations: 0, students: 0, reports: [] });
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
    withFacts({ codes: [], usage: [], conversations: 0, students: 0, reports: [] });
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
    withFacts({ codes: [], usage: [], conversations: 0, students: 0, reports: [] });
    expect(await render(TopActivitiesSection({ userId: "t1" }))).toBe("");
  });
});
