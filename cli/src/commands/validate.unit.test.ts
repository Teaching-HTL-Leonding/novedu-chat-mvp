// @vitest-environment node
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { runValidate } from "./validate";

// In-process, no network: drive the real validate handler (real loader + real
// file fetcher) over the committed fixtures in `tutors/`. Runs in CI.
const tutorsDir = fileURLToPath(new URL("../../../tutors/", import.meta.url));

describe("runValidate (local files)", () => {
  it("accepts a valid tutor and reports its model", async () => {
    const result = await runValidate(`${tutorsDir}simple-tutor.yaml`);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.model).toBeTruthy();
      expect(result.prompt.length).toBeGreaterThan(0);
    }
  });

  it("rejects a broken tutor with structured errors", async () => {
    const result = await runValidate(`${tutorsDir}broken-tutor.yaml`);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0]?.code).toBeTruthy();
    }
  });

  it("reports a missing file as a FETCH_FAILED error (no throw)", async () => {
    const result = await runValidate(`${tutorsDir}does-not-exist.yaml`);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors[0]?.code).toBe("FETCH_FAILED");
    }
  });
});
