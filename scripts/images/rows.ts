import type { Pool } from "pg";
import type { ImageRow } from "./types";

// The copy tool's ONLY database access: one read of every `novedu_images`
// version. Plain `pg` rather than the app's Drizzle store, exactly like the e2e
// suite's `e2e/db.ts` seam — the tool must be able to read rows a future app
// version no longer maps, and it must be obvious from this file that it issues
// no write. There is no UPDATE, INSERT or DELETE anywhere in this tool: the
// migration copies BYTES and leaves the metadata alone (`blob_path` values are
// preserved verbatim, so no row ever needs to change).
//
// OPERATOR TOOLING, never bundled into the app or the CLI (scripts/images/README.md).

interface ImageRowShape {
  id: string;
  name: string;
  blob_path: string;
  mime_type: string;
  byte_size: number;
  valid_from: Date;
  valid_until: Date | null;
}

/**
 * Every row of `novedu_images` — historical versions included, oldest first.
 * `active` is the table's temporal predicate, `valid_until IS NULL`: the single
 * live version of a name, the one whose object MUST survive the migration.
 */
export async function loadImageRows(pool: Pool): Promise<ImageRow[]> {
  const result = await pool.query<ImageRowShape>(
    `SELECT id, name, blob_path, mime_type, byte_size, valid_from, valid_until
       FROM novedu_images
      ORDER BY valid_from ASC, id ASC`,
  );
  return result.rows.map((row) => ({
    id: row.id,
    name: row.name,
    key: row.blob_path,
    mimeType: row.mime_type,
    // `byte_size` is an `integer` column; `pg` hands integers back as numbers.
    byteSize: Number(row.byte_size),
    active: row.valid_until === null,
    validFrom: new Date(row.valid_from),
  }));
}
