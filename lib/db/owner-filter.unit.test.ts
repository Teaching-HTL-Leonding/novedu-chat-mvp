import { describe, expect, it } from "vitest";
import { ALL_OWNERS, parseOwner } from "@/lib/db/owner-filter";

const ME = "oid-me";
const OTHER = "oid-birgit";

describe("parseOwner", () => {
  it("reads an absent or blank param as the signed-in teacher", () => {
    // This is what makes the default list view param-free — and therefore what
    // makes ListFilterBar's "Clear" (a bare pathname push) land back on my items.
    for (const raw of [undefined, "", "   ", []]) {
      expect(parseOwner({ owner: raw }, ME)).toEqual({ value: "", createdBy: ME });
    }
  });

  it("drops the filter for the all-owners sentinel", () => {
    expect(parseOwner({ owner: ALL_OWNERS }, ME)).toEqual({
      value: ALL_OWNERS,
      createdBy: undefined,
    });
  });

  it("takes any other value as an oid, verbatim", () => {
    expect(parseOwner({ owner: OTHER }, ME)).toEqual({ value: OTHER, createdBy: OTHER });
    // Trimmed, so a hand-edited URL with stray whitespace still matches.
    expect(parseOwner({ owner: `  ${OTHER}  ` }, ME)).toEqual({
      value: OTHER,
      createdBy: OTHER,
    });
  });

  it("keeps an unknown oid rather than falling back — the control mirrors the URL", () => {
    // A stale bookmark must not silently become "my items": it filters (and finds
    // nothing), and the page appends the value as its own dropdown option.
    expect(parseOwner({ owner: "deadbeef" }, ME)).toEqual({
      value: "deadbeef",
      createdBy: "deadbeef",
    });
  });

  it("takes the first value of a repeated param", () => {
    expect(parseOwner({ owner: [OTHER, ALL_OWNERS] }, ME)).toEqual({
      value: OTHER,
      createdBy: OTHER,
    });
  });

  it("applies no filter at all when there is no signed-in user id", () => {
    // Pages coalesce a missing session id to "", which the stores treat as "no
    // filter" — the same behavior the old default-on checkbox had.
    expect(parseOwner({}, "")).toEqual({ value: "", createdBy: undefined });
  });
});
