import { describe, expect, it } from "vitest";
import { sum } from "@/lib/sum";

describe("sum", () => {
  it("adds the provided numbers together", () => {
    expect(sum(1, 2, 3)).toBe(6);
  });
});
