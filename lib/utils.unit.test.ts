import { describe, expect, it } from "vitest";
import { cn } from "./utils";

describe("cn", () => {
  it("lets the later utility win on conflict (the className-prop-as-delta contract)", () => {
    expect(cn("p-2 text-sm", "p-4")).toBe("text-sm p-4");
  });

  it("keeps non-conflicting utilities from all inputs", () => {
    expect(cn("flex min-h-0", "gap-2")).toBe("flex min-h-0 gap-2");
  });

  it("resolves clsx conditionals, arrays, and objects", () => {
    expect(cn("base", false && "off", ["arr", { on: true, hidden: false }])).toBe("base arr on");
  });

  it("merges opacity-modifier color utilities of the same family", () => {
    expect(cn("border-foreground/25", "border-foreground/15")).toBe("border-foreground/15");
  });

  it("passes through non-Tailwind classes untouched (CSS-module hashes, hooks)", () => {
    expect(cn("copilotKitChat", "not-prose")).toBe("copilotKitChat not-prose");
  });

  it("returns an empty string for no inputs", () => {
    expect(cn()).toBe("");
  });
});
