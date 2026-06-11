import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  fromShareLinkEntity,
  gcExpiredShareLinks,
  generateShortCode,
  isExpiredEntity,
  isSafePartitionKey,
  resolveShortCode,
  SHORT_CODE_PATTERN,
  type StoredShareLink,
  selectShareSource,
  storeShareLink,
  toShareLinkEntity,
} from "@/lib/share-link-store";
import { signSharePayload, verifyShareLink } from "@/lib/share-links";

// One shared fake TableClient instance: the store caches its client on
// globalThis, so the tests own a single configurable object instead of digging
// through constructor mock results.
const azure = vi.hoisted(() => {
  const client = {
    createTable: vi.fn(),
    createEntity: vi.fn(),
    deleteEntity: vi.fn(),
    listEntities: vi.fn(),
  };
  // Regular function so it is `new`-able; returning an object overrides `this`.
  return {
    client,
    TableClient: vi.fn(function TableClient() {
      return client;
    }),
  };
});

vi.mock("@azure/data-tables", () => ({
  TableClient: azure.TableClient,
  // Same shape as the real tag: strings quoted, numbers verbatim — close enough
  // to assert the exact filter the store sends.
  odata: (strings: TemplateStringsArray, ...values: unknown[]) =>
    strings.reduce(
      (acc, part, i) =>
        i < values.length
          ? `${acc}${part}${typeof values[i] === "string" ? `'${values[i]}'` : String(values[i])}`
          : acc + part,
      "",
    ),
}));

vi.mock("@azure/identity", () => ({
  AzureCliCredential: vi.fn(),
  ChainedTokenCredential: vi.fn(),
  ManagedIdentityCredential: vi.fn(),
}));

function asyncRows(rows: Record<string, unknown>[], failWith?: Error) {
  return {
    async *[Symbol.asyncIterator]() {
      for (const row of rows) yield row;
      if (failWith) throw failWith;
    },
  };
}

const LINK: StoredShareLink = {
  tutor: "https://example.com/tutor.yaml",
  start: 1_700_000_000,
  end: 1_700_003_600,
  sig: "ab12cd34",
  origin: "http://localhost:3000",
};

const USER = "u_abc-123";
const NOW = 1_700_000_100;

beforeEach(() => {
  // reset (not clear): earlier tests install mockRejectedValue implementations,
  // which must not leak; vitest 4 resets vi.fn back to its original impl.
  vi.resetAllMocks();
  // The store caches the client (keyed by account name) across calls — reset
  // between tests so every test starts from a fresh env read.
  delete (globalThis as { shareLinkTableClient?: unknown }).shareLinkTableClient;
  vi.stubEnv("AZURE_STORAGE_ACCOUNT_NAME", "stunittest");
  azure.client.listEntities.mockReturnValue(asyncRows([]));
  // Degrade paths log on purpose; keep the test output clean.
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("generateShortCode", () => {
  it("produces 10 lowercase letters/digits", () => {
    for (let i = 0; i < 50; i++) {
      expect(generateShortCode()).toMatch(SHORT_CODE_PATTERN);
    }
  });

  it("never draws from Math.random (node:crypto randomInt is the source)", () => {
    const mathRandom = vi.spyOn(Math, "random");
    generateShortCode();
    expect(mathRandom).not.toHaveBeenCalled();
  });

  it("produces distinct codes across calls", () => {
    const codes = new Set(Array.from({ length: 100 }, generateShortCode));
    expect(codes.size).toBe(100);
  });
});

describe("entity mapping", () => {
  it("round-trips a stored link through entity form", () => {
    const entity = toShareLinkEntity(USER, "abc123def4", LINK);
    expect(entity.partitionKey).toBe(USER);
    expect(entity.rowKey).toBe("abc123def4");
    expect(fromShareLinkEntity({ ...entity })).toEqual(LINK);
  });

  it("ignores extra columns from the table", () => {
    const entity = {
      ...toShareLinkEntity(USER, "abc123def4", LINK),
      etag: 'W/"x"',
      timestamp: "t",
    };
    expect(fromShareLinkEntity(entity)).toEqual(LINK);
  });

  it.each([
    ["missing tutor", { ...LINK, tutor: undefined }],
    ["missing sig", { ...LINK, sig: undefined }],
    ["start as string", { ...LINK, start: "1700000000" }],
    ["end NaN", { ...LINK, end: Number.NaN }],
  ])("rejects malformed rows: %s", (_label, row) => {
    expect(fromShareLinkEntity(row as Record<string, unknown>)).toBeUndefined();
  });

  it("resolves rows WITHOUT origin — the column is operator documentation only", () => {
    // A short code must work on any origin (created on localhost, opened in
    // prod), so resolution never depends on the stored origin.
    const { origin: _origin, ...row } = toShareLinkEntity(USER, "abc123def4", LINK);
    expect(fromShareLinkEntity(row)).toEqual({
      tutor: LINK.tutor,
      start: LINK.start,
      end: LINK.end,
      sig: LINK.sig,
    });
  });
});

describe("isExpiredEntity", () => {
  it("is expired strictly after the window end", () => {
    expect(isExpiredEntity({ end: NOW - 1 }, NOW)).toBe(true);
  });

  it("is NOT expired at exactly the window end (inclusive bound, like verifyShareLink)", () => {
    expect(isExpiredEntity({ end: NOW }, NOW)).toBe(false);
  });

  it("is not expired before the window end", () => {
    expect(isExpiredEntity({ end: NOW + 1 }, NOW)).toBe(false);
  });
});

describe("isSafePartitionKey", () => {
  it("accepts base64url-shaped Entra subs", () => {
    expect(isSafePartitionKey("AAbb12-_x")).toBe(true);
  });

  it.each(["", "a/b", "a\\b", "a#b", "a?b", "a b", "ä"])("rejects %j", (value) => {
    expect(isSafePartitionKey(value)).toBe(false);
  });
});

describe("storeShareLink", () => {
  it("stores the link under the user's partition with a fresh code", async () => {
    const result = await storeShareLink(USER, LINK);
    expect(result.stored).toBe(true);
    const code = result.stored ? result.code : "";
    expect(code).toMatch(SHORT_CODE_PATTERN);
    expect(azure.client.createEntity).toHaveBeenCalledWith({
      partitionKey: USER,
      rowKey: code,
      ...LINK,
    });
  });

  it("degrades when storage is not configured", async () => {
    vi.stubEnv("AZURE_STORAGE_ACCOUNT_NAME", "");
    expect(await storeShareLink(USER, LINK)).toEqual({ stored: false });
    expect(azure.TableClient).not.toHaveBeenCalled();
  });

  it("creates the table before the first write, and only once per process", async () => {
    await storeShareLink(USER, LINK);
    await storeShareLink(USER, LINK);
    expect(azure.client.createTable).toHaveBeenCalledTimes(1);
    expect(azure.client.createTable.mock.invocationCallOrder[0]).toBeLessThan(
      azure.client.createEntity.mock.invocationCallOrder[0] ?? 0,
    );
  });

  it("degrades when the table cannot be created, without attempting the write", async () => {
    azure.client.createTable.mockRejectedValue(new Error("403"));
    expect(await storeShareLink(USER, LINK)).toEqual({ stored: false });
    expect(azure.client.createEntity).not.toHaveBeenCalled();
  });

  it("degrades on an unsafe partition key without touching storage", async () => {
    expect(await storeShareLink("user/1", LINK)).toEqual({ stored: false });
    expect(azure.client.createEntity).not.toHaveBeenCalled();
  });

  it("degrades when the write fails", async () => {
    azure.client.createEntity.mockRejectedValue(new Error("403"));
    expect(await storeShareLink(USER, LINK)).toEqual({ stored: false });
  });

  it("retries with a fresh code when the generated code is already taken (409)", async () => {
    azure.client.createEntity
      .mockRejectedValueOnce({ statusCode: 409, name: "RestError" })
      .mockResolvedValueOnce(undefined);
    const result = await storeShareLink(USER, LINK);
    expect(result.stored).toBe(true);
    expect(azure.client.createEntity).toHaveBeenCalledTimes(2);
    const codes = azure.client.createEntity.mock.calls.map(
      ([entity]) => (entity as { rowKey: string }).rowKey,
    );
    expect(codes[0]).not.toBe(codes[1]);
    expect(result.stored && result.code).toBe(codes[1]);
  });

  it("does not retry non-conflict write errors", async () => {
    azure.client.createEntity.mockRejectedValue({ statusCode: 403 });
    expect(await storeShareLink(USER, LINK)).toEqual({ stored: false });
    expect(azure.client.createEntity).toHaveBeenCalledTimes(1);
  });

  it("gives up after bounded attempts when every code conflicts", async () => {
    azure.client.createEntity.mockRejectedValue({ statusCode: 409 });
    expect(await storeShareLink(USER, LINK)).toEqual({ stored: false });
    expect(azure.client.createEntity).toHaveBeenCalledTimes(10);
  });

  it("does not run garbage collection (that is gcExpiredShareLinks' job, off the response path)", async () => {
    await storeShareLink(USER, LINK);
    expect(azure.client.listEntities).not.toHaveBeenCalled();
    expect(azure.client.deleteEntity).not.toHaveBeenCalled();
  });
});

describe("gcExpiredShareLinks", () => {
  it("deletes only the user's expired links (end < now)", async () => {
    azure.client.listEntities.mockReturnValue(
      asyncRows([
        { partitionKey: USER, rowKey: "old1old1ol" },
        { partitionKey: USER, rowKey: "old2old2ol" },
      ]),
    );
    await gcExpiredShareLinks(USER, NOW);
    expect(azure.client.listEntities).toHaveBeenCalledWith({
      queryOptions: {
        filter: `PartitionKey eq '${USER}' and end lt ${NOW}`,
        select: ["partitionKey", "rowKey"],
      },
    });
    expect(azure.client.deleteEntity).toHaveBeenCalledTimes(2);
    expect(azure.client.deleteEntity).toHaveBeenCalledWith(USER, "old1old1ol");
    expect(azure.client.deleteEntity).toHaveBeenCalledWith(USER, "old2old2ol");
  });

  it("is a no-op when storage is not configured", async () => {
    vi.stubEnv("AZURE_STORAGE_ACCOUNT_NAME", "");
    await expect(gcExpiredShareLinks(USER, NOW)).resolves.toBeUndefined();
    expect(azure.TableClient).not.toHaveBeenCalled();
  });

  it("never throws when the list query fails", async () => {
    azure.client.listEntities.mockReturnValue(asyncRows([], new Error("boom")));
    await expect(gcExpiredShareLinks(USER, NOW)).resolves.toBeUndefined();
  });

  it("never throws when deleting an expired link fails", async () => {
    azure.client.listEntities.mockReturnValue(
      asyncRows([{ partitionKey: USER, rowKey: "old1old1ol" }]),
    );
    azure.client.deleteEntity.mockRejectedValue(new Error("409"));
    await expect(gcExpiredShareLinks(USER, NOW)).resolves.toBeUndefined();
  });
});

describe("resolveShortCode", () => {
  it.each([
    "",
    "short",
    "UPPERCASE1",
    "abc123def",
    "abc123def45",
    "abc/23def4",
    "abc 23def4",
  ])("rejects malformed code %j without a storage call", async (code) => {
    expect(await resolveShortCode(code)).toEqual({ ok: false, reason: "unknown-code" });
    expect(azure.TableClient).not.toHaveBeenCalled();
    expect(azure.client.listEntities).not.toHaveBeenCalled();
  });

  it("resolves a stored code across partitions", async () => {
    azure.client.listEntities.mockReturnValue(
      asyncRows([{ partitionKey: USER, rowKey: "abc123def4", ...LINK }]),
    );
    expect(await resolveShortCode("abc123def4")).toEqual({ ok: true, link: LINK });
    // The opener does not know the creator, so the filter must NOT pin a partition.
    expect(azure.client.listEntities).toHaveBeenCalledWith({
      queryOptions: { filter: "RowKey eq 'abc123def4'" },
    });
    // Reads never provision the table — a missing table just resolves no codes.
    expect(azure.client.createTable).not.toHaveBeenCalled();
  });

  it("reports unknown-code when no row matches", async () => {
    expect(await resolveShortCode("abc123def4")).toEqual({ ok: false, reason: "unknown-code" });
  });

  it("reports unknown-code for a malformed row", async () => {
    azure.client.listEntities.mockReturnValue(
      asyncRows([{ partitionKey: USER, rowKey: "abc123def4", tutor: 42 }]),
    );
    expect(await resolveShortCode("abc123def4")).toEqual({ ok: false, reason: "unknown-code" });
  });

  it("reports lookup-failed when the query throws", async () => {
    azure.client.listEntities.mockReturnValue(asyncRows([], new Error("offline")));
    expect(await resolveShortCode("abc123def4")).toEqual({ ok: false, reason: "lookup-failed" });
  });

  it("reports lookup-failed when storage is not configured", async () => {
    vi.stubEnv("AZURE_STORAGE_ACCOUNT_NAME", "");
    expect(await resolveShortCode("abc123def4")).toEqual({ ok: false, reason: "lookup-failed" });
  });
});

describe("selectShareSource", () => {
  it("prefers the full signed parameter set over a short code", () => {
    expect(selectShareSource({ tutor: "https://t", sig: "ab", link: "abc123def4" })).toBe("full");
  });

  it("selects full when tutor and sig are present", () => {
    expect(selectShareSource({ tutor: "https://t", sig: "ab" })).toBe("full");
  });

  it("selects code when only a link code is present", () => {
    expect(selectShareSource({ link: "abc123def4" })).toBe("code");
  });

  it("selects code for an incomplete full set with a link", () => {
    expect(selectShareSource({ tutor: "https://t", link: "abc123def4" })).toBe("code");
  });

  it("selects none without sig/link", () => {
    expect(selectShareSource({ tutor: "https://t" })).toBe("none");
    expect(selectShareSource({ sig: "ab" })).toBe("none");
    expect(selectShareSource({})).toBe("none");
  });
});

describe("resolved codes still go through verifyShareLink", () => {
  const SECRET = "unit-test-secret";

  function resolveAndVerify(link: StoredShareLink, nowSeconds: number) {
    // Mirrors app/page.tsx: stored values are fed to the SAME verification as a
    // full link — storage is an index, the HMAC stays the security boundary.
    return verifyShareLink(
      { tutor: link.tutor, start: String(link.start), end: String(link.end), sig: link.sig },
      SECRET,
      nowSeconds,
    );
  }

  function signedLink(): StoredShareLink {
    const payload = { tutor: LINK.tutor, start: LINK.start, end: LINK.end };
    return { ...payload, sig: signSharePayload(payload, SECRET), origin: LINK.origin };
  }

  it("accepts a stored link inside its window", () => {
    const verification = resolveAndVerify(signedLink(), LINK.start + 10);
    expect(verification.ok).toBe(true);
  });

  it("rejects a stored link whose window is over", () => {
    const verification = resolveAndVerify(signedLink(), LINK.end + 1);
    expect(verification).toMatchObject({ ok: false, reason: "expired" });
  });

  it("rejects a stored link signed with a different secret", () => {
    const foreign = { ...signedLink(), sig: signSharePayload(LINK, "other-secret") };
    expect(resolveAndVerify(foreign, LINK.start + 10)).toEqual({
      ok: false,
      reason: "invalid-signature",
    });
  });
});
