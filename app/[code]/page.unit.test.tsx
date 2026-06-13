// @vitest-environment node

import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

// `app/[code]/page.tsx` is THE consumer of checkTutorCode on the chat page: it
// maps each window outcome to a rejection view and decides which dead codes drop
// from the user's recent-codes shortcuts. Finding 4 (2026-06-12-findings.md)
// flags that no CI test exercises this HTTP-path consumer — unit tests cover the
// check's logic, but not how the page consumes the result. Here we invoke the
// server component directly with mocked I/O and render its output; no DB, runs
// in CI. (The valid-code path that loads the real tutor + chat stays @live.)

const auth = vi.hoisted(() => vi.fn());
const checkTutorCode = vi.hoisted(() => vi.fn());
const recordRecentCode = vi.hoisted(() => vi.fn());
const removeRecentCode = vi.hoisted(() => vi.fn());
const loadAndBuildTutorPrompt = vi.hoisted(() => vi.fn());

vi.mock("@/auth", () => ({ auth }));
vi.mock("@/lib/tutor-code-store", () => ({ checkTutorCode }));
vi.mock("@/lib/recent-code-store", () => ({ recordRecentCode, removeRecentCode }));
vi.mock("@/lib/tutors", () => ({
  loadAndBuildTutorPrompt,
  defaultFetcher: {},
  sampleExampleQuestions: (q: unknown) => q ?? [],
}));
// Stub the chat so the happy path needs no CopilotKit/runtime.
vi.mock("../tutor-chat", () => ({
  TutorChat: ({ code }: { code: string }) => <div data-testid="chat">chat for {code}</div>,
}));
// after() schedules the recents mutation; run it inline so the call is observable.
vi.mock("next/server", () => ({ after: (fn: () => void) => fn() }));

// signThreadToken (real) runs on the valid path; it needs AUTH_SECRET.
process.env.AUTH_SECRET = "test-secret-for-page-unit";

import TutorCodePage from "./page";

const CODE = "a1b2c3d4e5";
const USER_ID = "u1";
const FROM = new Date("2026-06-10T10:00:00Z");
const UNTIL = new Date("2026-06-10T14:00:00Z");

async function renderPage(code = CODE) {
  const element = await TutorCodePage({ params: Promise.resolve({ code }) });
  return renderToStaticMarkup(element);
}

beforeEach(() => {
  vi.clearAllMocks();
  auth.mockResolvedValue({ user: { id: USER_ID } });
});

describe("rejection branches (finding 4)", () => {
  it("expired → renders the expiry view AND drops the dead code from recents", async () => {
    checkTutorCode.mockResolvedValue({
      ok: false,
      reason: "expired",
      validFrom: FROM,
      validUntil: UNTIL,
    });
    const html = await renderPage();
    expect(html).toContain("Tutor code expired");
    expect(removeRecentCode).toHaveBeenCalledWith(USER_ID, CODE);
    expect(recordRecentCode).not.toHaveBeenCalled();
  });

  it("unknown-code → renders the unknown view AND drops it from recents", async () => {
    checkTutorCode.mockResolvedValue({ ok: false, reason: "unknown-code" });
    const html = await renderPage();
    expect(html).toContain("Unknown tutor code");
    expect(removeRecentCode).toHaveBeenCalledWith(USER_ID, CODE);
  });

  it("not-started → renders the not-yet view and KEEPS it in recents", async () => {
    checkTutorCode.mockResolvedValue({
      ok: false,
      reason: "not-started",
      validFrom: FROM,
      validUntil: UNTIL,
    });
    const html = await renderPage();
    expect(html).toContain("Tutor not available yet");
    expect(removeRecentCode).not.toHaveBeenCalled();
    expect(recordRecentCode).not.toHaveBeenCalled();
  });

  it("lookup-failed → renders the transient view and touches no recents", async () => {
    checkTutorCode.mockResolvedValue({ ok: false, reason: "lookup-failed" });
    const html = await renderPage();
    expect(html).toContain("Tutor codes temporarily unavailable");
    expect(removeRecentCode).not.toHaveBeenCalled();
  });
});

describe("valid code branches", () => {
  const validEntry = { ok: true, entry: { tutorUrl: "https://example.com/t.yaml" } };

  it("valid + loadable tutor → records a recent and renders the chat", async () => {
    checkTutorCode.mockResolvedValue(validEntry);
    loadAndBuildTutorPrompt.mockResolvedValue({
      ok: true,
      prompt: "system prompt",
      warnings: [],
      imageInput: true,
      title: "Tutor",
      description: "",
      exampleQuestions: [],
    });
    const html = await renderPage();
    expect(html).toContain("chat for a1b2c3d4e5");
    expect(recordRecentCode).toHaveBeenCalledWith(USER_ID, CODE);
  });

  it("valid + broken tutor → renders the load-failure notice and error list, no chat", async () => {
    checkTutorCode.mockResolvedValue(validEntry);
    loadAndBuildTutorPrompt.mockResolvedValue({
      ok: false,
      errors: [{ code: "MISSING_REQUIRED_VARIABLE", message: "Required variable missing." }],
      warnings: [],
    });
    const html = await renderPage();
    expect(html).toContain("This tutor cannot be loaded");
    expect(html).toContain("MISSING_REQUIRED_VARIABLE");
    expect(html).not.toContain('data-testid="chat"');
  });
});
