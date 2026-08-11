import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_PAGE_SIZE,
  lastPage,
  MAX_PAGE_SIZE,
  pageHref,
  paginate,
  parsePaging,
} from "@/lib/db/paging";

describe("parsePaging", () => {
  it("defaults to the first page at the default size", () => {
    expect(parsePaging({})).toEqual({ page: 1, pageSize: DEFAULT_PAGE_SIZE });
  });

  it("reads a valid page and size", () => {
    expect(parsePaging({ page: "3", size: "50" })).toEqual({ page: 3, pageSize: 50 });
  });

  it("falls back for anything unparseable, zero or negative", () => {
    for (const bad of ["", "   ", "abc", "0", "-1", "2.5", "1e3"]) {
      expect(parsePaging({ page: bad, size: bad })).toEqual({
        page: 1,
        pageSize: DEFAULT_PAGE_SIZE,
      });
    }
  });

  it("caps size at MAX_PAGE_SIZE but keeps size=1 legal", () => {
    expect(parsePaging({ size: "1000" }).pageSize).toBe(MAX_PAGE_SIZE);
    // size=1 is how the e2e suite forces a multi-page list out of two rows.
    expect(parsePaging({ size: "1" }).pageSize).toBe(1);
  });

  it("takes the first value of a repeated param", () => {
    expect(parsePaging({ page: ["2", "9"] })).toEqual({ page: 2, pageSize: DEFAULT_PAGE_SIZE });
  });
});

describe("pageHref", () => {
  it("preserves the other filter params", () => {
    expect(pageHref("/codes", { q: "bio", mine: "0", module: "quiz" }, 2, DEFAULT_PAGE_SIZE)).toBe(
      "/codes?q=bio&mine=0&module=quiz&page=2",
    );
  });

  it("omits page at 1 and size at the default, so page 1 matches an Apply URL", () => {
    expect(pageHref("/files", { q: "a" }, 1, DEFAULT_PAGE_SIZE)).toBe("/files?q=a");
    expect(pageHref("/files", {}, 1, DEFAULT_PAGE_SIZE)).toBe("/files");
  });

  it("carries a non-default size onto every page", () => {
    expect(pageHref("/files", { q: "a" }, 2, 1)).toBe("/files?q=a&page=2&size=1");
    expect(pageHref("/files", {}, 1, 50)).toBe("/files?size=50");
  });

  it("drops the incoming page/size rather than duplicating them", () => {
    expect(pageHref("/files", { page: "7", size: "50", q: "a" }, 2, 50)).toBe(
      "/files?q=a&page=2&size=50",
    );
  });

  it("takes the first value of a repeated param and escapes the query string", () => {
    expect(pageHref("/reports", { q: ["a b", "z"] }, 2, DEFAULT_PAGE_SIZE)).toBe(
      "/reports?q=a+b&page=2",
    );
  });
});

describe("lastPage", () => {
  it("is 1 for an empty list", () => {
    expect(lastPage(0, 20)).toBe(1);
  });

  it("handles exact multiples and partial last pages", () => {
    expect(lastPage(40, 20)).toBe(2);
    expect(lastPage(41, 20)).toBe(3);
    expect(lastPage(1, 20)).toBe(1);
  });
});

describe("paginate", () => {
  it("skips the COUNT entirely when unpaged and reports rows.length as the total", async () => {
    const count = vi.fn(async () => 99);
    const rows = vi.fn(async () => ["a", "b", "c"]);

    const result = await paginate({ paging: undefined, count, rows });

    expect(count).not.toHaveBeenCalled();
    expect(rows).toHaveBeenCalledWith(); // no window ⇒ no OFFSET/FETCH
    expect(result).toEqual({ rows: ["a", "b", "c"], total: 3, page: 1, pageSize: 3 });
  });

  it("never hands out a pageSize of 0 for an empty unpaged result", async () => {
    // A 0 would make lastPage() divide by zero for any future consumer.
    const result = await paginate({
      paging: undefined,
      count: async () => 0,
      rows: async () => [],
    });
    expect(result.pageSize).toBe(1);
  });

  it("windows the row query and runs each query once for an in-range page", async () => {
    const count = vi.fn(async () => 137);
    const rows = vi.fn(async () => ["r"]);

    const result = await paginate({ paging: { page: 3, pageSize: 20 }, count, rows });

    expect(count).toHaveBeenCalledOnce();
    expect(rows).toHaveBeenCalledExactlyOnceWith({ offset: 40, limit: 20 });
    expect(result).toEqual({ rows: ["r"], total: 137, page: 3, pageSize: 20 });
  });

  it("clamps an over-shot page and re-runs the row query exactly once", async () => {
    const count = vi.fn(async () => 25);
    const rows = vi
      .fn<(window?: { offset: number; limit: number }) => Promise<string[]>>()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce(["last"]);

    const result = await paginate({ paging: { page: 9, pageSize: 20 }, count, rows });

    expect(rows).toHaveBeenNthCalledWith(1, { offset: 160, limit: 20 });
    expect(rows).toHaveBeenNthCalledWith(2, { offset: 20, limit: 20 }); // page 2 is the last
    expect(rows).toHaveBeenCalledTimes(2);
    expect(result).toEqual({ rows: ["last"], total: 25, page: 2, pageSize: 20 });
  });

  it("reports page 1 for an empty result without a second query", async () => {
    const rows = vi.fn(async () => []);

    const result = await paginate({
      paging: { page: 7, pageSize: 20 },
      count: async () => 0,
      rows,
    });

    expect(rows).toHaveBeenCalledOnce();
    expect(result).toEqual({ rows: [], total: 0, page: 1, pageSize: 20 });
  });
});
