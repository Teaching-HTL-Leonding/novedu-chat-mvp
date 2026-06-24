// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// `lib/image-blob` is the ONE seam that talks to Azure Blob Storage. These tests
// mock `@azure/storage-blob` so NO network / credentials are touched, and assert
// the SAS-minting contract:
//   - the WRITE SAS is create-only ("c"), https, short-lived (~10min);
//   - the READ SAS is read-only ("r"), https, longer-lived (~3h);
//   - both pin the SAS to the blob and account;
//   - the user-delegation key is fetched ONCE and reused across mints (the cache).
// The credential builder is stubbed out — we never reach the wire.

const azure = vi.hoisted(() => {
  // `generateBlobSASQueryParameters` is captured so each test reads back the SAS
  // values the SUT requested; it returns a marker that `.toString()`s to a query.
  const generateBlobSASQueryParameters = vi.fn(() => ({ toString: () => "sig=stub" }));
  const getUserDelegationKey = vi.fn(async () => ({ value: "delegation-key" }));
  // One BlockBlobClient per path, exposing the public `url` the SUT appends `?sas` to.
  const getBlockBlobClient = vi.fn((blobPath: string) => ({
    url: `https://stnoveduchatmvp.blob.core.windows.net/novedu-images/${blobPath}`,
    getProperties: vi.fn(),
    deleteIfExists: vi.fn(async () => undefined),
  }));
  const getContainerClient = vi.fn(() => ({ getBlockBlobClient }));
  class BlobServiceClient {
    getUserDelegationKey = getUserDelegationKey;
    getContainerClient = getContainerClient;
  }
  // Mirrors the real enum/permission API surface the SUT uses.
  const BlobSASPermissions = { parse: (s: string) => ({ perm: s, toString: () => s }) };
  const SASProtocol = { Https: "https" };
  class RestError extends Error {
    statusCode?: number;
    constructor(message: string, opts?: { statusCode?: number }) {
      super(message);
      this.statusCode = opts?.statusCode;
    }
  }
  return {
    generateBlobSASQueryParameters,
    getUserDelegationKey,
    getBlockBlobClient,
    getContainerClient,
    BlobServiceClient,
    BlobSASPermissions,
    SASProtocol,
    RestError,
  };
});

vi.mock("@azure/storage-blob", () => ({
  BlobServiceClient: azure.BlobServiceClient,
  generateBlobSASQueryParameters: azure.generateBlobSASQueryParameters,
  BlobSASPermissions: azure.BlobSASPermissions,
  SASProtocol: azure.SASProtocol,
  RestError: azure.RestError,
}));
vi.mock("@/lib/azure-credential", () => ({ buildDataStoreCredential: () => ({}) }));

// Read the captured SAS-values argument of the Nth `generateBlobSASQueryParameters` call.
function sasValuesOf(call: number) {
  return (azure.generateBlobSASQueryParameters.mock.calls[call] as unknown[])?.[0] as {
    containerName: string;
    blobName: string;
    permissions: { perm: string };
    protocol: string;
    startsOn: Date;
    expiresOn: Date;
    contentType?: string;
  };
}

beforeEach(() => {
  // The azure spies live in the hoisted block (shared across the file), and each
  // test re-imports the SUT after `vi.resetModules()` — so clear the captured
  // calls/counts here, or one test's mints leak into the next's assertions.
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-06-24T12:00:00Z"));
});

afterEach(() => {
  vi.useRealTimers();
  vi.resetModules();
});

describe("mintWriteSas", () => {
  it("mints a create-only, https, ~10min SAS pinned to the blob/account and content type", async () => {
    const { mintWriteSas } = await import("@/lib/image-blob");
    const now = Date.now();
    const url = await mintWriteSas("abc.png", "image/png");

    expect(url).toBe(
      "https://stnoveduchatmvp.blob.core.windows.net/novedu-images/abc.png?sig=stub",
    );
    const values = sasValuesOf(0);
    expect(values.permissions.perm).toBe("c");
    expect(values.protocol).toBe(azure.SASProtocol.Https);
    expect(values.containerName).toBe("novedu-images");
    expect(values.blobName).toBe("abc.png");
    expect(values.contentType).toBe("image/png");
    // ~10min lifetime, with a small negative-skew start.
    expect(values.startsOn.getTime()).toBeLessThan(now);
    expect(values.expiresOn.getTime() - now).toBe(10 * 60 * 1000);
    // The account is the third positional arg.
    expect((azure.generateBlobSASQueryParameters.mock.calls[0] as unknown[])?.[2]).toBe(
      "stnoveduchatmvp",
    );
  });
});

describe("mintReadSas", () => {
  it("mints a read-only, https, ~3h SAS pinned to the blob", async () => {
    const { mintReadSas } = await import("@/lib/image-blob");
    const now = Date.now();
    const url = await mintReadSas("abc.png");

    expect(url).toBe(
      "https://stnoveduchatmvp.blob.core.windows.net/novedu-images/abc.png?sig=stub",
    );
    const values = sasValuesOf(0);
    expect(values.permissions.perm).toBe("r");
    expect(values.protocol).toBe(azure.SASProtocol.Https);
    expect(values.blobName).toBe("abc.png");
    // A read SAS pins no content type (only the write upload does).
    expect(values.contentType).toBeUndefined();
    expect(values.startsOn.getTime()).toBeLessThan(now);
    expect(values.expiresOn.getTime() - now).toBe(3 * 60 * 60 * 1000);
  });
});

describe("delegation-key cache", () => {
  it("fetches the user-delegation key ONCE across two mints", async () => {
    const { mintWriteSas, mintReadSas } = await import("@/lib/image-blob");
    await mintWriteSas("a.png", "image/png");
    await mintReadSas("b.png");
    expect(azure.getUserDelegationKey).toHaveBeenCalledTimes(1);
    // Both mints still produced a signature (the cached key was reused).
    expect(azure.generateBlobSASQueryParameters).toHaveBeenCalledTimes(2);
  });
});

describe("getBlobProperties", () => {
  it("returns metadata for an existing blob", async () => {
    const { getBlobProperties } = await import("@/lib/image-blob");
    azure.getBlockBlobClient.mockReturnValueOnce({
      url: "https://x/abc.png",
      getProperties: vi.fn(async () => ({ contentType: "image/png", contentLength: 42 })),
      deleteIfExists: vi.fn(),
    });
    await expect(getBlobProperties("abc.png")).resolves.toEqual({
      exists: true,
      contentType: "image/png",
      contentLength: 42,
    });
  });

  it("maps a 404 RestError to { exists: false } rather than throwing", async () => {
    const { getBlobProperties } = await import("@/lib/image-blob");
    azure.getBlockBlobClient.mockReturnValueOnce({
      url: "https://x/ghost.png",
      getProperties: vi.fn(async () => {
        throw new azure.RestError("not found", { statusCode: 404 });
      }),
      deleteIfExists: vi.fn(),
    });
    await expect(getBlobProperties("ghost.png")).resolves.toEqual({ exists: false });
  });

  it("rethrows a non-404 error", async () => {
    const { getBlobProperties } = await import("@/lib/image-blob");
    azure.getBlockBlobClient.mockReturnValueOnce({
      url: "https://x/x.png",
      getProperties: vi.fn(async () => {
        throw new azure.RestError("boom", { statusCode: 500 });
      }),
      deleteIfExists: vi.fn(),
    });
    await expect(getBlobProperties("x.png")).rejects.toThrow("boom");
  });
});

describe("deleteBlob", () => {
  it("delegates to deleteIfExists (a no-op when already gone)", async () => {
    const { deleteBlob } = await import("@/lib/image-blob");
    const deleteIfExists = vi.fn(async () => undefined);
    azure.getBlockBlobClient.mockReturnValueOnce({
      url: "https://x/abc.png",
      getProperties: vi.fn(),
      deleteIfExists,
    });
    await deleteBlob("abc.png");
    expect(deleteIfExists).toHaveBeenCalledTimes(1);
  });
});
