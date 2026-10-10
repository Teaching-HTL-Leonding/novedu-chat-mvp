import type { BetterAuthOptions } from "better-auth";
import { describe, expect, it, vi } from "vitest";
import { demoAuthOptions } from "@/lib/auth-demo-options";
import { mergeAuthOptions } from "@/lib/auth-options-merge";

// auth.ts = the shared base + exactly one mode block, merged explicitly
// (docs/auth.md, "Demo mode"): a shallow spread would drop the base's nested
// `account.modelName` or replace its `disabledPaths`.

const base = {
  secret: "s",
  account: { modelName: "novedu_account" },
  disabledPaths: ["/update-user"],
} satisfies BetterAuthOptions;

function clearEntraEnv() {
  for (const name of [
    "AZURE_CLIENT_ID",
    "AZURE_CLIENT_SECRET",
    "AZURE_TENANT_ID",
    "TEACHER_GROUP_ID",
    "AUTH_URL",
  ]) {
    vi.stubEnv(name, "");
  }
}

describe("mergeAuthOptions", () => {
  it("keeps the shared account.modelName beside the block's account options", () => {
    const merged = mergeAuthOptions(base, {
      account: { accountLinking: { trustedProviders: ["microsoft"] } },
    });
    expect(merged.account).toEqual({
      modelName: "novedu_account",
      accountLinking: { trustedProviders: ["microsoft"] },
    });
  });

  it("concatenates disabledPaths", () => {
    expect(mergeAuthOptions(base, { disabledPaths: ["/x"] }).disabledPaths).toEqual([
      "/update-user",
      "/x",
    ]);
    expect(mergeAuthOptions(base, {}).disabledPaths).toEqual(["/update-user"]);
  });

  it("refuses a key both sides set", () => {
    expect(() =>
      mergeAuthOptions({ ...base, rateLimit: { window: 10 } }, { rateLimit: { max: 1 } }),
    ).toThrow(/"rateLimit" is set by both/);
    expect(() => mergeAuthOptions(base, { account: { modelName: "other" } })).toThrow(
      /"account.modelName" is set by both/,
    );
  });

  it("merges the demo block: email sign-in without sign-up, the class-sized rate limit", () => {
    clearEntraEnv();
    const merged: BetterAuthOptions = mergeAuthOptions(base, demoAuthOptions());
    expect(merged.emailAndPassword).toEqual({ enabled: true, disableSignUp: true });
    expect(merged.rateLimit?.customRules?.["/sign-in/email"]).toEqual({ window: 60, max: 100 });
    expect(merged.account).toEqual({ modelName: "novedu_account" });
    expect(merged.socialProviders).toBeUndefined();
  });
});

describe("demoAuthOptions", () => {
  it("refuses to build with Entra settings present", () => {
    clearEntraEnv();
    vi.stubEnv("AZURE_CLIENT_ID", "real-client");
    expect(() => demoAuthOptions()).toThrow(/AZURE_CLIENT_ID is set/);
  });
});
