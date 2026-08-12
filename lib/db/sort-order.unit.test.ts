import { asc, desc } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { files } from "@/lib/db/schema";
import { sortOrder } from "@/lib/db/sort-order";

// Real schema columns — `lib/db/schema.ts` imports only `drizzle-orm/mssql-core`,
// so this opens no connection.
const COLUMNS = { name: files.name, updated: files.validFrom };
const FALLBACK = [desc(files.validFrom)];
const TIEBREAK = asc(files.id);

describe("sortOrder", () => {
  it("uses the list's default order when nothing is sorted", () => {
    expect(sortOrder(undefined, COLUMNS, FALLBACK, TIEBREAK)).toEqual([...FALLBACK, TIEBREAK]);
  });

  it("falls back for a key outside the map rather than throwing", () => {
    // `parseSort` normally filters this out; a store called directly must stay on
    // its never-throw contract.
    expect(sortOrder({ key: "bogus", dir: "asc" }, COLUMNS, FALLBACK, TIEBREAK)).toEqual([
      ...FALLBACK,
      TIEBREAK,
    ]);
  });

  it("REPLACES the default order with the sorted column", () => {
    expect(sortOrder({ key: "name", dir: "asc" }, COLUMNS, FALLBACK, TIEBREAK)).toEqual([
      asc(files.name),
      TIEBREAK,
    ]);
    expect(sortOrder({ key: "name", dir: "desc" }, COLUMNS, FALLBACK, TIEBREAK)).toEqual([
      desc(files.name),
      TIEBREAK,
    ]);
  });

  it("always closes with the tiebreaker — the OFFSET/FETCH stability guarantee", () => {
    for (const sort of [undefined, { key: "name", dir: "desc" } as const]) {
      const order = sortOrder(sort, COLUMNS, FALLBACK, TIEBREAK);
      expect(order.at(-1)).toBe(TIEBREAK);
    }
  });
});
