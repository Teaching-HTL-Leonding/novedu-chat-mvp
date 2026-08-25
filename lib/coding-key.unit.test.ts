import { describe, expect, it } from "vitest";
import { generateCodingKey, KEY_PATTERN } from "@/lib/coding-key";

// The key FORMAT on its own — no database in sight (lib/coding-key.ts is the pure
// module the store and the e2e harness both build on).

describe("generateCodingKey", () => {
  it("mints the nvk- prefix plus 40 lowercase letters/digits", () => {
    for (let i = 0; i < 20; i++) {
      const key = generateCodingKey();
      expect(key).toMatch(KEY_PATTERN);
      expect(key.startsWith("nvk-")).toBe(true);
      // 4 prefix chars + 40 body chars.
      expect(key).toHaveLength(44);
      expect(key.slice(4)).toMatch(/^[a-z0-9]{40}$/);
    }
  });

  it("does not repeat itself (the keyspace is the whole security story)", () => {
    const keys = new Set(Array.from({ length: 50 }, () => generateCodingKey()));
    expect(keys.size).toBe(50);
  });
});

describe("KEY_PATTERN", () => {
  it("admits only a minted key shape", () => {
    expect(generateCodingKey()).toMatch(KEY_PATTERN);
    // A bare activity code is just another malformed bearer (the hard cutover).
    expect("a1b2c3d4e5").not.toMatch(KEY_PATTERN);
    expect(`key-${"a".repeat(40)}`).not.toMatch(KEY_PATTERN);
    expect(`nvk-${"a".repeat(39)}`).not.toMatch(KEY_PATTERN);
    expect(`nvk-${"a".repeat(41)}`).not.toMatch(KEY_PATTERN);
    expect(`nvk-${"A".repeat(40)}`).not.toMatch(KEY_PATTERN);
    expect(`nvk-${"a".repeat(39)}-`).not.toMatch(KEY_PATTERN);
  });
});
