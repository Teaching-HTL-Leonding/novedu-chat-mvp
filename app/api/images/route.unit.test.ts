// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

// The bearer image-list route: real auth gate over a stubbed `getSession`,
// mocked store + blob seam. Pins the 401/403 matrix, the /images page's filter
// parsing (mine default ON), the 503 mapping, and the wire shape (short-lived
// read-SAS url, null when minting fails for a row, createdAt = the active
// version's validFrom).

const mocks = vi.hoisted(() => ({
  listImages: vi.fn(),
  mintReadSas: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ getDb: () => ({}) }));
vi.mock("@/lib/image-store", () => ({ listImages: mocks.listImages }));
vi.mock("@/lib/image-blob", () => ({ mintReadSas: mocks.mintReadSas }));

vi.mock("@/auth", () => ({ auth: { api: { getSession: vi.fn() } } }));

import { auth } from "@/auth";
import { unpagedResult } from "@/lib/db/paging";
import { bearerSession } from "@/tests/mock-auth-session";
import { GET } from "./route";

const getSession = vi.mocked(auth.api.getSession);

async function mint(teacher = true): Promise<string> {
  getSession.mockResolvedValue(
    bearerSession({ id: "teacher-oid-1", name: "Test Teacher", isTeacher: teacher }),
  );
  return "session-token";
}

async function getRequest(query = "", token?: string): Promise<Response> {
  return GET(
    new Request(`http://localhost/api/images${query}`, {
      headers: token === undefined ? {} : { authorization: `Bearer ${token}` },
    }),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  getSession.mockReset();
  getSession.mockResolvedValue(null);
  mocks.listImages.mockResolvedValue(
    unpagedResult([
      {
        id: "v1-id",
        name: "diagram",
        blobPath: "abc.png",
        mimeType: "image/png",
        byteSize: 1234,
        credit: "CC BY 4.0",
        validFrom: new Date("2026-07-07T08:00:00Z"),
        createdBy: "teacher-oid-1",
      },
    ]),
  );
  mocks.mintReadSas.mockResolvedValue("https://blob.example/abc.png?sas=read");
});

describe("GET /api/images auth", () => {
  it("401s without a token, with WWW-Authenticate", async () => {
    const res = await getRequest();
    expect(res.status).toBe(401);
    expect(res.headers.get("www-authenticate")).toBe("Bearer");
    expect(mocks.listImages).not.toHaveBeenCalled();
  });

  it("403s a valid non-teacher token", async () => {
    const res = await getRequest("", await mint(false));
    expect(res.status).toBe(403);
    expect(mocks.listImages).not.toHaveBeenCalled();
  });
});

describe("GET /api/images", () => {
  it("defaults to only the caller's images and returns the wire shape with a read-SAS url", async () => {
    const res = await getRequest("", await mint());
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(mocks.listImages).toHaveBeenCalledWith({
      search: undefined,
      createdBy: "teacher-oid-1",
    });
    expect(mocks.mintReadSas).toHaveBeenCalledWith("abc.png");
    expect(await res.json()).toEqual([
      {
        name: "diagram",
        mimeType: "image/png",
        byteSize: 1234,
        credit: "CC BY 4.0",
        createdBy: "teacher-oid-1",
        createdAt: "2026-07-07T08:00:00.000Z",
        url: "https://blob.example/abc.png?sas=read",
      },
    ]);
  });

  it("widens to all teachers with mine=0 and passes q through trimmed", async () => {
    await getRequest("?mine=0&q=%20gram%20", await mint());
    expect(mocks.listImages).toHaveBeenCalledWith({ search: "gram", createdBy: undefined });
  });

  it("returns url null for a row whose SAS minting fails, keeping the rest", async () => {
    mocks.listImages.mockResolvedValue(
      unpagedResult([
        {
          id: "v1",
          name: "bad",
          blobPath: "bad.png",
          mimeType: "image/png",
          byteSize: 1,
          credit: null,
          validFrom: new Date("2026-07-07T08:00:00Z"),
          createdBy: "teacher-oid-1",
        },
        {
          id: "v2",
          name: "good",
          blobPath: "good.png",
          mimeType: "image/jpeg",
          byteSize: 2,
          credit: null,
          validFrom: new Date("2026-07-07T09:00:00Z"),
          createdBy: "teacher-oid-1",
        },
      ]),
    );
    mocks.mintReadSas.mockImplementation((blobPath: string) =>
      blobPath === "bad.png"
        ? Promise.reject(new Error("mint failed"))
        : Promise.resolve(`https://blob.example/${blobPath}?sas=read`),
    );
    const res = await getRequest("", await mint());
    expect(res.status).toBe(200);
    const rows = await res.json();
    expect(rows.map((r: { name: string; url: string | null }) => r.url)).toEqual([
      null,
      "https://blob.example/good.png?sas=read",
    ]);
  });

  it("503s when the store is unreachable", async () => {
    mocks.listImages.mockResolvedValue(undefined);
    const res = await getRequest("", await mint());
    expect(res.status).toBe(503);
  });
});
