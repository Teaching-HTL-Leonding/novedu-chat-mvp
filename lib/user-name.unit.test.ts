import { describe, expect, it } from "vitest";
import { displayNameFromProfile } from "@/lib/user-name";

// The "which name do we store, and when do we skip?" decision behind the sign-in
// upsert (auth.ts). Pure, no DB — covers the trimming and every not-usable shape so
// the auth callback's guard is exercised without booting NextAuth.

describe("displayNameFromProfile", () => {
  it("returns the name claim, trimmed", () => {
    expect(displayNameFromProfile({ name: "Ada Lovelace" })).toBe("Ada Lovelace");
    expect(displayNameFromProfile({ name: "  Ada Lovelace  " })).toBe("Ada Lovelace");
  });

  it("returns null when there is no usable name", () => {
    expect(displayNameFromProfile({})).toBeNull();
    expect(displayNameFromProfile({ name: "" })).toBeNull();
    expect(displayNameFromProfile({ name: "   " })).toBeNull();
    expect(displayNameFromProfile({ name: null })).toBeNull();
    expect(displayNameFromProfile({ name: 42 })).toBeNull();
  });
});
