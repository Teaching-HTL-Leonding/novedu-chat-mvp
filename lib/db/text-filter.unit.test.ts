import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import { codes } from "@/lib/db/schema";
import { containsAny, escapeLikeTerm } from "@/lib/db/text-filter";

describe("escapeLikeTerm", () => {
  it("leaves a plain term untouched", () => {
    expect(escapeLikeTerm("linked lists")).toBe("linked lists");
  });

  it("escapes the LIKE wildcards % and _", () => {
    expect(escapeLikeTerm("50%")).toBe("50\\%");
    expect(escapeLikeTerm("a_b")).toBe("a\\_b");
    expect(escapeLikeTerm("[x]")).toBe("[x]"); // '[' is not a Postgres LIKE metacharacter
  });

  it("escapes backslash FIRST so it cannot double-escape a following wildcard", () => {
    // raw `\%` → backslash becomes `\\`, then `%` becomes `\%` ⇒ `\\\%`
    expect(escapeLikeTerm("\\%")).toBe("\\\\\\%");
  });
});

describe("containsAny", () => {
  it("returns undefined for a blank term (no filter)", () => {
    expect(containsAny("", [codes.note])).toBeUndefined();
    expect(containsAny("   ", [codes.note])).toBeUndefined();
  });

  it("returns undefined when there are no columns", () => {
    expect(containsAny("x", [])).toBeUndefined();
  });

  it("returns an SQL condition for a real term + column", () => {
    const condition = containsAny("hello", [codes.note, codes.code]);
    expect(condition).toBeDefined();
  });

  it("builds the condition with ILIKE (case-insensitive on Postgres)", () => {
    const condition = containsAny("hello", [codes.note]);
    if (!condition) throw new Error("expected a condition");
    const { sql } = new PgDialect().sqlToQuery(condition);
    expect(sql).toContain("ILIKE");
  });
});
