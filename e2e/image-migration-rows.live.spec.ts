import { randomUUID } from "node:crypto";
import { loadEnvConfig } from "@next/env";
import { expect, test } from "@playwright/test";
import { loadImageRows } from "../scripts/images/rows";
import { getPool, query } from "./db";

// @live-db: the ONE case of the operator-run image copy tool that genuinely needs
// real Postgres — `scripts/images/rows.ts`, which reads every `novedu_images`
// version and derives the temporal `active` flag from `valid_until IS NULL`. That
// classification decides whether a missing object blocks the production cutover
// (active) or is recorded as expected historical loss (closed), so it is tested
// against the real table rather than a fake. Everything else in the tool is
// covered hermetically by `scripts/images/core.unit.test.ts`.
//
// No storage credentials, no Azure, no LLM: this touches the metadata table only.
// It inserts its own two rows (one active, one closed, sharing a name the way a
// re-uploaded image does) and deletes exactly those rows again.
//
// Load `.env` into the Playwright runner's process, exactly like the other
// DB-backed e2e helpers, so `DATABASE_URL` is visible to `e2e/db.ts`.
loadEnvConfig(process.cwd());

const E2E_CREATOR = "e2e-test-suite";

test("loadImageRows returns every version and marks only the open one active", {
  tag: ["@live", "@live-db"],
}, async () => {
  test.skip(!process.env.DATABASE_URL, "DATABASE_URL is not set — cannot reach novedu_images");

  const name = `e2e-migration-${Date.now()}-${randomUUID().slice(0, 8)}`;
  const activeId = randomUUID();
  const closedId = randomUUID();
  const activeKey = `${randomUUID()}.png`;
  const closedKey = `${randomUUID()}.png`;

  try {
    // The closed version first, then the one that replaced it — the shape the
    // temporal table takes after a teacher re-uploads under the same name.
    await query(
      `INSERT INTO novedu_images
         (id, name, blob_path, mime_type, byte_size, credit, created_by, valid_from, valid_until, closed_by)
       VALUES ($1, $2, $3, $4, $5, NULL, $6, now() - interval '2 hours', now() - interval '1 hour', $6)`,
      [closedId, name, closedKey, "image/png", 1234, E2E_CREATOR],
    );
    await query(
      `INSERT INTO novedu_images
         (id, name, blob_path, mime_type, byte_size, credit, created_by, valid_from, valid_until, closed_by)
       VALUES ($1, $2, $3, $4, $5, NULL, $6, now() - interval '1 hour', NULL, NULL)`,
      [activeId, name, activeKey, "image/svg+xml", 4321, E2E_CREATOR],
    );

    const rows = await loadImageRows(getPool());

    const active = rows.find((row) => row.id === activeId);
    const closed = rows.find((row) => row.id === closedId);

    // HISTORY IS INCLUDED: the tool copies closed versions too, so a rollback to
    // the previous release still finds every object it ever served.
    expect(active, "the active version must be loaded").toBeDefined();
    expect(closed, "the closed version must be loaded too").toBeDefined();

    expect(active).toMatchObject({
      id: activeId,
      name,
      // `blob_path` is the opaque object key, preserved verbatim by the copy.
      key: activeKey,
      mimeType: "image/svg+xml",
      byteSize: 4321,
      active: true,
    });
    expect(active?.validFrom).toBeInstanceOf(Date);

    expect(closed).toMatchObject({
      id: closedId,
      name,
      key: closedKey,
      mimeType: "image/png",
      byteSize: 1234,
      active: false,
    });

    // Oldest first, so a manifest reads as the image's history.
    const activeIndex = rows.findIndex((row) => row.id === activeId);
    const closedIndex = rows.findIndex((row) => row.id === closedId);
    expect(closedIndex).toBeLessThan(activeIndex);

    // Exactly one live version per name — the partial unique index's invariant,
    // and the reason a missing object is only fatal for one row per image.
    expect(rows.filter((row) => row.name === name && row.active)).toHaveLength(1);
  } finally {
    await query("DELETE FROM novedu_images WHERE id = ANY($1)", [[activeId, closedId]]);
  }
});
