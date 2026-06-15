// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

// The only UNAUTHENTICATED surface of the YAML Files feature. These tests pin its
// status mapping: malformed name → 404 (no DB hit), DB error → 503 (transient,
// not "missing"), no active version → 404, active version → 200 raw YAML with
// no-store. The pure validateFileName stays real; only getActiveFile is mocked.

const mocks = vi.hoisted(() => ({ getActiveFile: vi.fn() }));

vi.mock("@/lib/db", () => ({ getDb: () => ({}) }));
vi.mock("@/lib/file-store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/file-store")>();
  return { ...actual, getActiveFile: mocks.getActiveFile };
});

import { GET } from "./route";

const req = () => new Request("http://localhost/api/files/whatever");
const call = (name: string) => GET(req(), { params: Promise.resolve({ name }) });

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/files/[name]", () => {
  it("404s a malformed name without hitting the database", async () => {
    const res = await call("bad name!");
    expect(res.status).toBe(404);
    expect(mocks.getActiveFile).not.toHaveBeenCalled();
  });

  it("503s when the database is unreachable (transient, not missing)", async () => {
    mocks.getActiveFile.mockResolvedValue(undefined);
    const res = await call("linked-lists");
    expect(res.status).toBe(503);
  });

  it("404s an unknown or soft-deleted file", async () => {
    mocks.getActiveFile.mockResolvedValue(null);
    const res = await call("ghost");
    expect(res.status).toBe(404);
  });

  it("serves the active content as raw YAML with no-store", async () => {
    mocks.getActiveFile.mockResolvedValue({ name: "linked-lists", content: "id: x\n" });
    const res = await call("linked-lists");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/yaml");
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.text()).toBe("id: x\n");
  });
});
