import { describe, expect, it } from "vitest";
import { formatSort, nextSort, parseSort, sortHref } from "@/lib/db/sorting";

// The allow-list a list store exports. `parseSort` only reads its keys, so plain
// placeholders stand in for the drizzle columns here.
const ALLOWED = { name: 0, kind: 0, updated: 0 };

describe("parseSort", () => {
  it("is absent for a missing, blank or bare-dash param", () => {
    for (const raw of [undefined, "", "   ", "-", ["", "name"]]) {
      expect(parseSort({ sort: raw }, ALLOWED)).toBeUndefined();
    }
  });

  it("reads a plain key as ascending and a leading dash as descending", () => {
    expect(parseSort({ sort: "name" }, ALLOWED)).toEqual({ key: "name", dir: "asc" });
    expect(parseSort({ sort: "-name" }, ALLOWED)).toEqual({ key: "name", dir: "desc" });
  });

  it("ignores a key the list cannot sort by", () => {
    expect(parseSort({ sort: "bogus" }, ALLOWED)).toBeUndefined();
    expect(parseSort({ sort: "-bogus" }, ALLOWED)).toBeUndefined();
  });

  it("ignores inherited object keys — the allow-list is own-keys only", () => {
    // Without `Object.hasOwn`, `?sort=toString` would sort by a prototype member.
    for (const raw of ["toString", "constructor", "__proto__"]) {
      expect(parseSort({ sort: raw }, ALLOWED)).toBeUndefined();
    }
  });

  it("takes the first value of a repeated param", () => {
    expect(parseSort({ sort: ["kind", "name"] }, ALLOWED)).toEqual({ key: "kind", dir: "asc" });
  });

  it("round-trips through formatSort", () => {
    for (const sort of [
      { key: "name", dir: "asc" },
      { key: "updated", dir: "desc" },
    ] as const) {
      expect(parseSort({ sort: formatSort(sort) }, ALLOWED)).toEqual(sort);
    }
  });
});

describe("nextSort", () => {
  it("starts a fresh column ascending", () => {
    expect(nextSort(undefined, "name")).toEqual({ key: "name", dir: "asc" });
    expect(nextSort({ key: "kind", dir: "desc" }, "name")).toEqual({ key: "name", dir: "asc" });
  });

  it("cycles asc → desc → no sort on the active column", () => {
    expect(nextSort({ key: "name", dir: "asc" }, "name")).toEqual({ key: "name", dir: "desc" });
    expect(nextSort({ key: "name", dir: "desc" }, "name")).toBeUndefined();
  });
});

describe("sortHref", () => {
  it("sets the sort and preserves the other filter params", () => {
    const href = sortHref("/files", { q: "tutor", mine: "0" }, "name", undefined);
    expect(href).toBe("/files?q=tutor&mine=0&sort=name");
  });

  it("keeps a non-default size but drops the page — a re-sorted page 3 is a different set", () => {
    const href = sortHref("/files", { size: "1", page: "3" }, "name", undefined);
    expect(href).toBe("/files?size=1&sort=name");
  });

  it("flips the active column to descending", () => {
    const href = sortHref("/files", { sort: "name" }, "name", { key: "name", dir: "asc" });
    expect(href).toBe("/files?sort=-name");
  });

  it("clears the sort on the third click, back to the bare filtered URL", () => {
    const href = sortHref("/files", { q: "a", sort: "-name" }, "name", {
      key: "name",
      dir: "desc",
    });
    expect(href).toBe("/files?q=a");
  });

  it("returns the bare pathname when nothing is left to carry", () => {
    expect(sortHref("/files", { sort: "-name" }, "name", { key: "name", dir: "desc" })).toBe(
      "/files",
    );
  });

  it("starts another column ascending, replacing the active sort", () => {
    const href = sortHref("/files", { sort: "-name" }, "kind", { key: "name", dir: "desc" });
    expect(href).toBe("/files?sort=kind");
  });

  it("takes the first value of a repeated param and escapes the query string", () => {
    const href = sortHref("/files", { q: ["a b&c", "x"] }, "name", undefined);
    expect(href).toBe("/files?q=a+b%26c&sort=name");
  });
});
