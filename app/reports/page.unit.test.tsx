// @vitest-environment node

import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

// `app/reports/page.tsx` is the teacher gate + the filtered reports inbox. A
// non-teacher (incl. a teacher in student mode) must get "Access denied" WITHOUT
// any list query; a teacher gets the rows rendered. The store, auth, the server
// bulk actions, and the client detail dialog are mocked — this pins the gating,
// the default filter params passed to the store, and that rows render. No DB.

const isEffectiveTeacher = vi.hoisted(() => vi.fn());
const auth = vi.hoisted(() => vi.fn());
const listReports = vi.hoisted(() => vi.fn());

vi.mock("@/lib/student-mode", () => ({ isEffectiveTeacher }));
vi.mock("@/auth", () => ({ auth }));
vi.mock("@/lib/report-store", () => ({ listReports }));
// The server bulk actions pull heavy server-only transitive imports; the page only
// forwards them as props, so a stub keeps the test hermetic.
vi.mock("@/lib/report-actions", () => ({
  markSelectedReportsResolvedAction: vi.fn(),
  reopenSelectedReportsAction: vi.fn(),
  deleteSelectedReportsAction: vi.fn(),
}));
// The detail dialog is a client component (markdown renderer etc.) — its content
// is covered elsewhere; here it is a stub so the row action cell renders.
vi.mock("./report-detail-button", () => ({
  ReactionBadge: ({ reaction }: { reaction: string }) => <span>{reaction}</span>,
  ReportDetailButton: () => <button type="button">details</button>,
}));
vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));
// SelectionProvider (client) calls useRouter; a static server render has no app
// router mounted, so stub it.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
  usePathname: () => "/reports",
}));

import ReportsPage from "./page";

const OID = "teacher-oid-1";

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: "11111111-1111-1111-1111-111111111111",
    kind: "chat" as const,
    code: "abc123",
    codeNote: "My Class",
    userId: "student-oid-9",
    displayName: "Dana Student",
    reaction: "holysh" as const,
    description: "Something went wrong here",
    createdAt: new Date("2026-07-20T10:00:00Z"),
    threadId: "thread-1",
    questionId: null,
    questionText: null,
    answerText: null,
    feedbackText: null,
    verdict: null,
    hadImages: false,
    resolvedAt: null,
    resolvedBy: null,
    ...overrides,
  };
}

async function renderPage(sp: Record<string, string> = {}) {
  const element = await ReportsPage({ searchParams: Promise.resolve(sp) });
  return renderToStaticMarkup(element);
}

beforeEach(() => {
  vi.clearAllMocks();
  auth.mockResolvedValue({ user: { id: OID } });
  listReports.mockResolvedValue([row()]);
});

it("denies a non-teacher (or a teacher in student mode) without querying reports", async () => {
  isEffectiveTeacher.mockResolvedValue(false);
  const html = await renderPage();
  expect(html).toContain("Access denied");
  expect(listReports).not.toHaveBeenCalled();
});

describe("teacher", () => {
  beforeEach(() => {
    isEffectiveTeacher.mockResolvedValue(true);
  });

  it("renders the report rows", async () => {
    const html = await renderPage();
    expect(html).not.toContain("Access denied");
    expect(html).toContain("Dana Student");
    expect(html).toContain("My Class");
    // The description is no longer a list column (it can be long) — it lives only
    // in the detail dialog now.
    expect(html).not.toContain("Something went wrong here");
  });

  it("links the transcript action back to the reports inbox via ?from=reports", async () => {
    const html = await renderPage();
    // The chat row's "Open transcript" link tags the origin so the transcript
    // page shows "Back to reports" instead of "Back to stats".
    expect(html).toContain(`href="/codes/abc123/c/thread-1?from=reports"`);
  });

  it("defaults the status filter to open and only-my-codes on (passes the session oid)", async () => {
    await renderPage();
    expect(listReports).toHaveBeenCalledTimes(1);
    expect(listReports).toHaveBeenCalledWith(
      expect.objectContaining({ status: "open", codeCreatedBy: OID }),
    );
  });

  it("passes the reaction filter and drops only-my-codes when mine=0", async () => {
    await renderPage({ reaction: "bad", mine: "0" });
    expect(listReports).toHaveBeenCalledWith(
      expect.objectContaining({ status: "open", reaction: "bad", codeCreatedBy: undefined }),
    );
  });

  it("ignores an unknown reaction value", async () => {
    await renderPage({ reaction: "nonsense" });
    expect(listReports).toHaveBeenCalledWith(expect.objectContaining({ reaction: undefined }));
  });

  it("shows the unavailable notice when the store errors", async () => {
    listReports.mockResolvedValue(undefined);
    const html = await renderPage();
    expect(html).toContain("Reports temporarily unavailable");
  });
});
