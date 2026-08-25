// @vitest-environment node

import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

// The coding module's student render: it mints (or re-displays) the caller's
// personal API key via `getOrCreateCodingKey`, then shows the connection block plus
// the mandatory attribution notice — or a "temporarily unavailable" notice when the
// key store fails. `loadCoding` is mocked (no DB/YAML fetch); `codingConnectionProps`
// is the real, pure derivation. Invoked directly (it is an async server component);
// runs in CI.

const loadCoding = vi.hoisted(() => vi.fn());
const getOrCreateCodingKey = vi.hoisted(() => vi.fn());

vi.mock("@/lib/coding-fetch", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/coding-fetch")>()),
  loadCoding,
}));
vi.mock("@/lib/coding-key-store", () => ({ getOrCreateCodingKey }));

import type { CodeEntry } from "@/lib/code-store";
import { RenderCoding } from "./render-coding";

const entry = {
  code: "a1b2c3d4e5",
  module: "coding",
  fileUrl: "https://example.com/api/files/c",
} as unknown as CodeEntry;

async function render() {
  const element = await RenderCoding({ entry, code: "a1b2c3d4e5", userId: "u1" });
  return renderToStaticMarkup(element);
}

beforeEach(() => {
  vi.clearAllMocks();
  loadCoding.mockResolvedValue({ ok: true, coding: { title: "My Coding Activity" } });
});

describe("RenderCoding", () => {
  it("key minted → renders the personal key + the attribution notice", async () => {
    getOrCreateCodingKey.mockResolvedValue({
      code: "a1b2c3d4e5",
      userId: "u1",
      apiKey: "nvk-abc123",
      createdAt: new Date("2026-06-10T10:00:00Z"),
    });
    const html = await render();
    expect(getOrCreateCodingKey).toHaveBeenCalledWith("a1b2c3d4e5", "u1");
    expect(html).toContain("nvk-abc123");
    expect(html).toContain("recorded with your name for your teacher");
    expect(html).toContain("not stored");
    expect(html).not.toContain("temporarily unavailable");
  });

  it("key store failure (null) → renders the unavailable notice, no key/connection block", async () => {
    getOrCreateCodingKey.mockResolvedValue(null);
    const html = await render();
    expect(html).toContain("Connection details temporarily unavailable");
    expect(html).not.toContain("recorded with your name");
  });
});
