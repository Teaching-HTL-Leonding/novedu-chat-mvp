import { describe, expect, it } from "vitest";
import { givenNameFromIdToken } from "./given-name";

/** A signature-free JWT shape: only the payload segment is ever read. */
function idToken(payload: Record<string, unknown>): string {
  const body = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  return `header.${body}.signature`;
}

describe("givenNameFromIdToken", () => {
  it("returns the trimmed given_name claim", () => {
    expect(givenNameFromIdToken(idToken({ given_name: " Rainer ", name: "Stropek Rainer" }))).toBe(
      "Rainer",
    );
  });

  it("keeps non-ASCII and multi-word given names intact", () => {
    expect(givenNameFromIdToken(idToken({ given_name: "Anna Lückl" }))).toBe("Anna Lückl");
  });

  it("returns null when the claim is missing", () => {
    expect(givenNameFromIdToken(idToken({ name: "Stropek Rainer" }))).toBeNull();
  });

  it("returns null for an empty or whitespace-only claim", () => {
    expect(givenNameFromIdToken(idToken({ given_name: "" }))).toBeNull();
    expect(givenNameFromIdToken(idToken({ given_name: "   " }))).toBeNull();
  });

  it("returns null for a non-string claim", () => {
    expect(givenNameFromIdToken(idToken({ given_name: 42 }))).toBeNull();
    expect(givenNameFromIdToken(idToken({ given_name: ["Rainer"] }))).toBeNull();
  });

  it("returns null for a malformed token", () => {
    expect(givenNameFromIdToken("garbage")).toBeNull();
  });
});
