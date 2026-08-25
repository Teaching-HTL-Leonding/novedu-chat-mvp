// @vitest-environment node

import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

// The coding module's teacher detail body: the resolved config (model + system
// prompt), the teacher's OWN connection block once they hold a personal key, and
// the read-only issued-keys list. The key read is READ-ONLY — viewing the page
// must never mint — so the no-key state offers the "Get my API key" button plus
// its attribution notice instead. `auth`, the key store, and `loadCoding` are
// mocked; `codingConnectionProps` is the real, pure derivation. Invoked directly
// (an async server component); runs in CI, no DB.

const auth = vi.hoisted(() => vi.fn());
const getStoredCodingKey = vi.hoisted(() => vi.fn());
const getOrCreateCodingKey = vi.hoisted(() => vi.fn());
const listCodingKeys = vi.hoisted(() => vi.fn());
const loadCoding = vi.hoisted(() => vi.fn());

vi.mock("@/auth", () => ({ auth }));
vi.mock("@/lib/coding-key-store", () => ({
  getStoredCodingKey,
  // Exported here only so the component can be caught calling it: the mint path
  // belongs to the button's server action, never to a render.
  getOrCreateCodingKey,
  listCodingKeys,
}));
vi.mock("@/lib/coding-fetch", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/coding-fetch")>()),
  loadCoding,
}));

import { CodingDetail } from "@/app/[code]/_coding/coding-detail";
import type { CodeEntry } from "@/lib/code-store";

const entry = {
  code: "a1b2c3d4e5",
  module: "coding",
  fileUrl: "https://example.com/api/files/c",
  anonymous: true,
  llm: null,
} as unknown as CodeEntry;

async function render() {
  return renderToStaticMarkup(await CodingDetail({ entry }));
}

const teacherKey = {
  status: "found" as const,
  key: {
    code: "a1b2c3d4e5",
    userId: "teacher-oid-1",
    apiKey: "nvk-teacherkey",
    createdAt: new Date("2026-06-10T10:00:00Z"),
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  auth.mockResolvedValue({ user: { id: "teacher-oid-1" } });
  loadCoding.mockResolvedValue({
    ok: true,
    coding: { title: "My Coding Activity", instructions: "Be a helpful coding tutor." },
  });
  listCodingKeys.mockResolvedValue([]);
  getStoredCodingKey.mockResolvedValue({ status: "none" });
});

describe("the teacher's own connection block", () => {
  it("renders the stored key, read (never minted) for the session oid", async () => {
    getStoredCodingKey.mockResolvedValue(teacherKey);
    const html = await render();
    expect(getStoredCodingKey).toHaveBeenCalledWith("a1b2c3d4e5", "teacher-oid-1");
    expect(html).toContain("nvk-teacherkey");
    expect(html).not.toContain("Get my API key");
  });

  it("NEVER mints while rendering — the button's action owns that", async () => {
    await render();
    expect(getOrCreateCodingKey).not.toHaveBeenCalled();
  });

  it("offers the button and the attribution notice when no key is stored yet", async () => {
    const html = await render();
    expect(html).toContain("Get my API key");
    expect(html).toContain("records your name in this activity");
    expect(html).toContain("Coding conversations are not stored");
    expect(html).not.toContain("nvk-");
  });

  it("renders the unavailable notice — not the button — when the read fails", async () => {
    getStoredCodingKey.mockResolvedValue({ status: "error" });
    const html = await render();
    expect(html).toContain("Connection details temporarily unavailable");
    expect(html).not.toContain("Get my API key");
  });

  it("renders the unavailable notice when there is no session oid", async () => {
    auth.mockResolvedValue(null);
    const html = await render();
    expect(getStoredCodingKey).not.toHaveBeenCalled();
    expect(html).toContain("Connection details temporarily unavailable");
    expect(html).not.toContain("Get my API key");
  });
});

describe("issued-keys list", () => {
  beforeEach(() => {
    getStoredCodingKey.mockResolvedValue(teacherKey);
  });

  it("heads the identity column 'User' — a teacher can legitimately appear in it", async () => {
    listCodingKeys.mockResolvedValue([
      { userId: "student-oid-1", displayName: "Ada Lovelace", createdAt: new Date() },
    ]);
    const html = await render();
    expect(html).toContain(">User<");
    expect(html).not.toContain(">Student<");
  });

  it("shows the resolved display name, with the oid as the hover title", async () => {
    listCodingKeys.mockResolvedValue([
      {
        userId: "student-oid-1",
        displayName: "Ada Lovelace",
        createdAt: new Date("2026-06-11T14:32:00Z"),
      },
    ]);
    const html = await render();
    expect(html).toContain("Ada Lovelace");
    expect(html).toContain('title="student-oid-1"');
    // The shared LocalTime leaf: a <time> carrying the ISO instant, rendered in
    // the viewer's own zone — the convention every sibling teacher list uses.
    expect(html).toMatch(/<time [^>]*="2026-06-11T14:32:00\.000Z"/);
  });

  it("falls back to the oid when no display name has been recorded", async () => {
    listCodingKeys.mockResolvedValue([
      { userId: "student-oid-2", displayName: null, createdAt: new Date("2026-06-11T14:32:00Z") },
    ]);
    const html = await render();
    expect(html).toContain(">student-oid-2<");
  });

  it("shows the empty paragraph, and no table, when nobody has requested a key yet", async () => {
    listCodingKeys.mockResolvedValue([]);
    const html = await render();
    expect(html).toContain("No keys requested yet");
    expect(html).not.toContain("<table");
  });

  it("never renders a key VALUE from the issued-keys list", async () => {
    listCodingKeys.mockResolvedValue([
      { userId: "student-oid-1", displayName: "Ada Lovelace", createdAt: new Date() },
    ]);
    const html = await render();
    // Only the teacher's OWN key may appear — it can legitimately show up more
    // than once (the key field + the models.json snippet), but never a second,
    // different key value.
    const keys = new Set(html.match(/nvk-[a-z0-9]+/g));
    expect(keys).toEqual(new Set(["nvk-teacherkey"]));
  });
});
