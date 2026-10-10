import type { BetterAuthOptions } from "better-auth";

// auth.ts builds ONE better-auth instance from a shared base plus exactly one mode
// block — `entraAuthOptions()` or `demoAuthOptions()` (docs/auth.md, "Demo mode").
// The merge is explicit rather than a shallow spread, which would silently drop
// a nested base option (the shared `account.modelName`) or replace a list
// (`disabledPaths`) instead of extending it.

/** What a mode block may contribute to the better-auth options. */
export type AuthModeBlock = Pick<
  BetterAuthOptions,
  | "socialProviders"
  | "emailAndPassword"
  | "account"
  | "databaseHooks"
  | "rateLimit"
  | "disabledPaths"
>;

/** Top-level keys both sides may set: merged one level deep / concatenated. */
const SHARED_KEYS = new Set<string>(["account", "disabledPaths"]);

/**
 * `base` with `block` merged in: `account` one level deep (a key set on both
 * sides is a conflict), `disabledPaths` concatenated, every other block key added
 * as-is — and a conflict when the base already sets it. Returns the base's own
 * type, so the instance keeps the inferred session shape (`additionalFields`,
 * plugins) the base declares.
 */
export function mergeAuthOptions<Base extends BetterAuthOptions>(
  base: Base,
  block: AuthModeBlock,
): Base {
  for (const key of Object.keys(block)) {
    if (!SHARED_KEYS.has(key) && key in base) {
      throw new Error(`auth options: "${key}" is set by both the shared base and the mode block`);
    }
  }
  for (const key of Object.keys(block.account ?? {})) {
    if (base.account && key in base.account) {
      throw new Error(
        `auth options: "account.${key}" is set by both the shared base and the mode block`,
      );
    }
  }
  return {
    ...base,
    ...block,
    account: { ...base.account, ...block.account },
    disabledPaths: [...(base.disabledPaths ?? []), ...(block.disabledPaths ?? [])],
  };
}
