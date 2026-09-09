// @vitest-environment node

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { auditVerdict, copyImages, inventoryUnreferenced, reverseCopy } from "./core";
import type { DestinationStore, ImageRow, SourceObject, WritableSourceStore } from "./types";

// The copy tool's decision logic against IN-MEMORY fakes: no Azure, no database,
// no filesystem. These tests are the evidence for the tool's data-safety rules —
// never overwrite, never delete, never fabricate a missing object — which are the
// rules that decide whether a production cutover may proceed.

const NOW = new Date("2026-09-01T10:00:00.000Z");

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function bytes(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

function row(overrides: Partial<ImageRow> = {}): ImageRow {
  const base: ImageRow = {
    id: "11111111-1111-4111-8111-111111111111",
    name: "diagram",
    key: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.png",
    mimeType: "image/png",
    byteSize: bytes("png-bytes").byteLength,
    active: true,
    validFrom: NOW,
  };
  return { ...base, ...overrides };
}

interface FakeSource extends WritableSourceStore {
  objects: Map<string, SourceObject>;
  puts: { key: string; bytes: Uint8Array; contentType: string }[];
}

function fakeSource(initial: Record<string, SourceObject> = {}): FakeSource {
  const objects = new Map(Object.entries(initial));
  const puts: FakeSource["puts"] = [];
  return {
    objects,
    puts,
    async get(key) {
      return objects.get(key) ?? null;
    },
    async *list() {
      for (const key of objects.keys()) yield key;
    },
    async put(key, value, contentType) {
      puts.push({ key, bytes: value, contentType });
      objects.set(key, { bytes: value, contentType });
    },
  };
}

interface FakeDestination extends DestinationStore {
  objects: Map<string, { bytes: Uint8Array; contentType: string }>;
  writes: { key: string; bytes: Uint8Array; contentType: string }[];
}

function fakeDestination(
  initial: Record<string, { bytes: Uint8Array; contentType: string }> = {},
): FakeDestination {
  const objects = new Map(Object.entries(initial));
  const writes: FakeDestination["writes"] = [];
  return {
    objects,
    writes,
    async read(key) {
      return objects.get(key)?.bytes ?? null;
    },
    async write(key, value, contentType) {
      writes.push({ key, bytes: value, contentType });
      objects.set(key, { bytes: value, contentType });
    },
  };
}

const COPY = { dryRun: false } as const;

describe("copyImages", () => {
  it("copies a present object and records the full manifest entry", async () => {
    const content = bytes("png-bytes");
    const image = row();
    const source = fakeSource({ [image.key]: { bytes: content, contentType: "image/png" } });
    const dest = fakeDestination();

    const manifest = await copyImages([image], source, dest, COPY);

    expect(manifest).toHaveLength(1);
    expect(manifest[0]).toEqual({
      id: image.id,
      key: image.key,
      active: true,
      sourceExists: true,
      sourceSize: content.byteLength,
      sourceContentType: "image/png",
      destinationPath: `images/${image.key}/content`,
      sha256: sha256(content),
      destinationSha256: sha256(content),
      status: "copied",
    });
    // The bytes landed under the PRESERVED key, with the row's MIME.
    expect(dest.writes).toEqual([{ key: image.key, bytes: content, contentType: "image/png" }]);
    expect(auditVerdict(manifest).ok).toBe(true);
  });

  it("skips a destination that already holds identical bytes", async () => {
    const content = bytes("png-bytes");
    const image = row();
    const source = fakeSource({ [image.key]: { bytes: content, contentType: "image/png" } });
    const dest = fakeDestination({ [image.key]: { bytes: content, contentType: "image/png" } });

    const manifest = await copyImages([image], source, dest, COPY);

    expect(manifest[0]?.status).toBe("skipped-identical");
    expect(manifest[0]?.destinationSha256).toBe(sha256(content));
    expect(dest.writes).toEqual([]);
  });

  it("reports a divergent destination and leaves it untouched", async () => {
    const content = bytes("png-bytes");
    const other = bytes("something-else");
    const image = row({ byteSize: content.byteLength });
    const source = fakeSource({ [image.key]: { bytes: content, contentType: "image/png" } });
    const dest = fakeDestination({ [image.key]: { bytes: other, contentType: "image/png" } });

    const manifest = await copyImages([image], source, dest, COPY);

    expect(manifest[0]?.status).toBe("mismatch");
    expect(manifest[0]?.sha256).toBe(sha256(content));
    expect(manifest[0]?.destinationSha256).toBe(sha256(other));
    expect(dest.writes).toEqual([]);
    // The existing object is exactly as it was — no overwrite, no deletion.
    expect(dest.objects.get(image.key)?.bytes).toBe(other);
    // A divergent ACTIVE image blocks the cutover.
    expect(auditVerdict(manifest).blockers).toHaveLength(1);
  });

  it("blocks on a missing object of an active row and records a missing historical one", async () => {
    const active = row({ id: "active-row", key: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.png" });
    const closed = row({
      id: "closed-row",
      key: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb.png",
      active: false,
    });
    const source = fakeSource();
    const dest = fakeDestination();

    const manifest = await copyImages([active, closed], source, dest, COPY);

    expect(manifest[0]).toMatchObject({
      status: "missing-active",
      sourceExists: false,
      sourceSize: null,
      sourceContentType: null,
      sha256: null,
      destinationSha256: null,
    });
    expect(manifest[1]?.status).toBe("missing-historical");
    // Nothing is fabricated for either row.
    expect(dest.writes).toEqual([]);

    const verdict = auditVerdict(manifest);
    expect(verdict.ok).toBe(false);
    expect(verdict.blockers.map((entry) => entry.id)).toEqual(["active-row"]);
  });

  it("is idempotent: a rerun after an interrupted run copies only what is missing", async () => {
    const first = bytes("first");
    const second = bytes("second-object");
    const rowA = row({ id: "a", key: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.png", byteSize: 5 });
    const rowB = row({
      id: "b",
      key: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb.png",
      byteSize: second.byteLength,
    });
    const source = fakeSource({
      [rowA.key]: { bytes: first, contentType: "image/png" },
      [rowB.key]: { bytes: second, contentType: "image/png" },
    });
    // The interrupted run got the first object across and then died.
    const dest = fakeDestination({ [rowA.key]: { bytes: first, contentType: "image/png" } });

    const firstRun = await copyImages([rowA, rowB], source, dest, COPY);
    expect(firstRun.map((entry) => entry.status)).toEqual(["skipped-identical", "copied"]);
    expect(dest.writes.map((write) => write.key)).toEqual([rowB.key]);

    const secondRun = await copyImages([rowA, rowB], source, dest, COPY);
    expect(secondRun.map((entry) => entry.status)).toEqual([
      "skipped-identical",
      "skipped-identical",
    ]);
    // Still exactly the one write from the first run.
    expect(dest.writes).toHaveLength(1);
    expect(auditVerdict(secondRun).ok).toBe(true);
  });

  it("flags a size disagreement with the SQL row", async () => {
    const content = bytes("png-bytes");
    const image = row({ byteSize: content.byteLength + 10 });
    const source = fakeSource({ [image.key]: { bytes: content, contentType: "image/png" } });
    const dest = fakeDestination();

    const manifest = await copyImages([image], source, dest, COPY);

    expect(manifest[0]?.status).toBe("size-mismatch");
    expect(manifest[0]?.sourceSize).toBe(content.byteLength);
    // The bytes still crossed — the flag reports, it does not skip.
    expect(dest.writes).toHaveLength(1);
    expect(auditVerdict(manifest).ok).toBe(false);
  });

  it("flags a Content-Type disagreement, ignoring parameters and case", async () => {
    const content = bytes("png-bytes");
    const image = row();
    const mismatched = fakeSource({ [image.key]: { bytes: content, contentType: "image/jpeg" } });
    const decorated = fakeSource({
      [image.key]: { bytes: content, contentType: "IMAGE/PNG; charset=binary" },
    });
    const missingType = fakeSource({ [image.key]: { bytes: content, contentType: null } });

    const flagged = await copyImages([image], mismatched, fakeDestination(), COPY);
    expect(flagged[0]?.status).toBe("mime-mismatch");
    expect(flagged[0]?.sourceContentType).toBe("image/jpeg");

    const equivalent = await copyImages([image], decorated, fakeDestination(), COPY);
    expect(equivalent[0]?.status).toBe("copied");

    // An object with no stored Content-Type cannot disagree — it is recorded as null.
    const untyped = await copyImages([image], missingType, fakeDestination(), COPY);
    expect(untyped[0]?.status).toBe("copied");
    expect(untyped[0]?.sourceContentType).toBeNull();
  });

  it("writes nothing in a dry run", async () => {
    const content = bytes("png-bytes");
    const image = row();
    const source = fakeSource({ [image.key]: { bytes: content, contentType: "image/png" } });
    const dest = fakeDestination();

    const manifest = await copyImages([image], source, dest, { dryRun: true });

    expect(manifest[0]?.status).toBe("copied");
    expect(manifest[0]?.sha256).toBe(sha256(content));
    // Planned, not performed: nothing was written and nothing re-read.
    expect(manifest[0]?.destinationSha256).toBeNull();
    expect(dest.writes).toEqual([]);
    expect(dest.objects.size).toBe(0);
  });

  it("audits parity only: an absent destination is a mismatch, never a plan", async () => {
    const content = bytes("png-bytes");
    const image = row();
    const source = fakeSource({ [image.key]: { bytes: content, contentType: "image/png" } });
    const empty = fakeDestination();
    const filled = fakeDestination({ [image.key]: { bytes: content, contentType: "image/png" } });
    const audit = { dryRun: true, auditOnly: true };

    const failing = await copyImages([image], source, empty, audit);
    expect(failing[0]?.status).toBe("mismatch");
    expect(failing[0]?.destinationSha256).toBeNull();
    expect(empty.writes).toEqual([]);
    expect(auditVerdict(failing).ok).toBe(false);

    const passing = await copyImages([image], source, filled, audit);
    expect(passing[0]?.status).toBe("skipped-identical");
    expect(filled.writes).toEqual([]);
    expect(auditVerdict(passing).ok).toBe(true);
  });
});

describe("auditVerdict", () => {
  it("blocks only on active rows and never on historical loss", async () => {
    const content = bytes("png-bytes");
    const closedMissing = row({ id: "closed", key: "closed.png", active: false });
    const closedDivergent = row({
      id: "closed-divergent",
      key: "cccccccc-cccc-4ccc-8ccc-cccccccccccc.png",
      active: false,
      byteSize: content.byteLength,
    });
    const source = fakeSource({
      [closedDivergent.key]: { bytes: content, contentType: "image/png" },
    });
    const dest = fakeDestination({
      [closedDivergent.key]: { bytes: bytes("other"), contentType: "image/png" },
    });

    const manifest = await copyImages([closedMissing, closedDivergent], source, dest, COPY);

    expect(manifest.map((entry) => entry.status)).toEqual(["missing-historical", "mismatch"]);
    expect(auditVerdict(manifest)).toEqual({ ok: true, blockers: [] });
  });
});

describe("inventoryUnreferenced", () => {
  it("lists source objects no row points at, sorted, and touches nothing", async () => {
    const referenced = row({ key: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.png" });
    const source = fakeSource({
      [referenced.key]: { bytes: bytes("a"), contentType: "image/png" },
      "zzzz.png": { bytes: bytes("z"), contentType: "image/png" },
      "mmmm.png": { bytes: bytes("m"), contentType: "image/png" },
    });

    const orphans = await inventoryUnreferenced(source, [referenced]);

    expect(orphans).toEqual(["mmmm.png", "zzzz.png"]);
    // Inventory only — the source is exactly as it was.
    expect(source.objects.size).toBe(3);
    expect(source.puts).toEqual([]);
  });
});

describe("reverseCopy", () => {
  const since = new Date("2026-09-02T00:00:00.000Z");

  it("copies post-cutover objects back with the row's Content-Type", async () => {
    const content = bytes("svg-bytes");
    const image = row({
      id: "post-cutover",
      mimeType: "image/svg+xml",
      byteSize: content.byteLength,
      validFrom: new Date("2026-09-03T09:00:00.000Z"),
    });
    const source = fakeSource();
    const dest = fakeDestination({
      // The Files object carries no authoritative MIME — the row is the source of truth.
      [image.key]: { bytes: content, contentType: "application/octet-stream" },
    });

    const manifest = await reverseCopy([image], dest, source, since, COPY);

    expect(manifest).toHaveLength(1);
    expect(manifest[0]).toMatchObject({
      id: "post-cutover",
      key: image.key,
      destinationPath: image.key,
      sourceContentType: "image/svg+xml",
      sha256: sha256(content),
      destinationSha256: sha256(content),
      status: "copied",
    });
    expect(source.puts).toEqual([{ key: image.key, bytes: content, contentType: "image/svg+xml" }]);
  });

  it("ignores rows older than the cutover time", async () => {
    const older = row({ id: "before", validFrom: new Date("2026-09-01T23:59:59.000Z") });
    const dest = fakeDestination({
      [older.key]: { bytes: bytes("png-bytes"), contentType: "image/png" },
    });
    const source = fakeSource();

    const manifest = await reverseCopy([older], dest, source, since, COPY);

    expect(manifest).toEqual([]);
    expect(source.puts).toEqual([]);
  });

  it("skips an identical blob, reports a divergent one and writes nothing in a dry run", async () => {
    const content = bytes("png-bytes");
    const image = row({
      byteSize: content.byteLength,
      validFrom: new Date("2026-09-04T00:00:00.000Z"),
    });
    const dest = fakeDestination({ [image.key]: { bytes: content, contentType: "image/png" } });

    const identical = fakeSource({ [image.key]: { bytes: content, contentType: "image/png" } });
    const skipped = await reverseCopy([image], dest, identical, since, COPY);
    expect(skipped[0]?.status).toBe("skipped-identical");
    expect(identical.puts).toEqual([]);

    const divergent = fakeSource({
      [image.key]: { bytes: bytes("other-bytes"), contentType: "image/png" },
    });
    const reported = await reverseCopy([image], dest, divergent, since, COPY);
    expect(reported[0]?.status).toBe("mismatch");
    expect(divergent.puts).toEqual([]);
    expect(divergent.objects.get(image.key)?.bytes).toEqual(bytes("other-bytes"));

    const planned = fakeSource();
    const dryRun = await reverseCopy([image], dest, planned, since, { dryRun: true });
    expect(dryRun[0]?.status).toBe("copied");
    expect(dryRun[0]?.destinationSha256).toBeNull();
    expect(planned.puts).toEqual([]);
  });

  it("records a Files object that is gone without fabricating one", async () => {
    const image = row({ validFrom: new Date("2026-09-05T00:00:00.000Z") });
    const source = fakeSource();

    const manifest = await reverseCopy([image], fakeDestination(), source, since, COPY);

    expect(manifest[0]).toMatchObject({
      status: "missing-active",
      sourceExists: false,
      sha256: null,
    });
    expect(source.puts).toEqual([]);
    expect(auditVerdict(manifest).ok).toBe(false);
  });
});

describe("the tool's seams", () => {
  // House precedent for source-text guards: lib/prompt-dump.unit.test.ts. These
  // pin the two rules a reader of a manifest cannot verify for themselves: the
  // tool has no way to delete a stored object, and no way to change SQL.
  const read = (file: string) =>
    readFileSync(path.join(process.cwd(), "scripts", "images", file), "utf8");

  it("expose no delete operation on either store", () => {
    const types = read("types.ts");
    // The interfaces themselves: read/list/get/put/write only.
    expect(types).not.toMatch(/^\s*delete\s*[(<]/m);
    expect(types).not.toMatch(/\bremove\s*\(/);

    for (const file of ["azure.ts", "core.ts", "migrate-blob-to-files.ts"]) {
      const source = read(file);
      expect(source, `${file} must not call a delete API`).not.toMatch(
        /\.delete(IfExists)?\s*\(|deleteBlob|deleteFile|deleteDirectory|deleteImmutability/,
      );
    }
  });

  it("issue no SQL that could change a row", () => {
    for (const file of ["rows.ts", "migrate-blob-to-files.ts"]) {
      const source = read(file);
      expect(source, `${file} must not write SQL`).not.toMatch(
        /\b(INSERT\s+INTO|UPDATE\s+\w+\s+SET|DELETE\s+FROM|TRUNCATE|ALTER\s+TABLE)\b/i,
      );
    }
  });

  it("write the destination only through the app's own object layout", () => {
    // `images/<key>/content` is what lib/image-fs.ts reads back.
    expect(read("core.ts")).toMatch(/\$\{OBJECTS_DIR\}\/\$\{key\}\/\$\{CONTENT_FILE\}/);
    expect(read("azure.ts")).toMatch(/getDirectoryClient\(OBJECTS_DIR\)/);
  });
});
