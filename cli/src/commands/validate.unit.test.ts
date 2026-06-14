// @vitest-environment node
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { runValidate } from "./validate";

// In-process, no network: drive the real validate handler (real loader + real
// file fetcher) over the committed fixtures in `tutors/`. Runs in CI.
const tutorsDir = fileURLToPath(new URL("../../../tutors/", import.meta.url));

describe("runValidate — tutors (local files)", () => {
  it("accepts a valid tutor and reports its model", async () => {
    const outcome = await runValidate(`${tutorsDir}simple-tutor.yaml`, "tutor");

    expect(outcome.kind).toBe("tutor");
    expect(outcome.result.ok).toBe(true);
    if (outcome.kind === "tutor" && outcome.result.ok) {
      expect(outcome.result.model).toBeTruthy();
      expect(outcome.result.prompt.length).toBeGreaterThan(0);
    }
  });

  it("rejects a broken tutor with structured errors", async () => {
    const outcome = await runValidate(`${tutorsDir}broken-tutor.yaml`, "tutor");

    expect(outcome.result.ok).toBe(false);
    if (!outcome.result.ok) {
      expect(outcome.result.errors.length).toBeGreaterThan(0);
      expect(outcome.result.errors[0]?.code).toBeTruthy();
    }
  });

  it("reports a missing file as a FETCH_FAILED error (no throw)", async () => {
    const outcome = await runValidate(`${tutorsDir}does-not-exist.yaml`, "tutor");

    expect(outcome.result.ok).toBe(false);
    if (!outcome.result.ok) {
      expect(outcome.result.errors[0]?.code).toBe("FETCH_FAILED");
    }
  });
});

describe("runValidate — fragment libraries (local files)", () => {
  it("accepts a valid fragment file and lists its fragments", async () => {
    const outcome = await runValidate(`${tutorsDir}simple-fragments.yaml`, "fragment");

    expect(outcome.kind).toBe("fragment");
    expect(outcome.result.ok).toBe(true);
    if (outcome.kind === "fragment" && outcome.result.ok) {
      expect(outcome.result.fragmentFileId).toBe("simple-fragments");
      expect(outcome.result.fragmentIds.length).toBeGreaterThan(0);
    }
  });

  it("rejects a fragment file whose template uses an undeclared variable", async () => {
    const outcome = await runValidate(`${tutorsDir}broken-template-fragments.yaml`, "fragment");

    expect(outcome.result.ok).toBe(false);
    if (!outcome.result.ok) {
      expect(outcome.result.errors.some((e) => e.code === "FRAGMENT_TEMPLATE_ERROR")).toBe(true);
    }
  });
});
