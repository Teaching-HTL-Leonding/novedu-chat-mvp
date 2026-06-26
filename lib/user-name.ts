// Pure helper deciding which display name (if any) to record for a signed-in user.
// Kept in its OWN DB-free module so auth.ts can import it statically — the
// SQL-backed user-name STORE (lib/user-name-store.ts) is imported DYNAMICALLY there
// to keep the driver off the proxy's hot path — and so the "store the nav-bar name,
// skip a blank one" rule is unit-tested without booting NextAuth.

/**
 * The display name to record for a user from their Entra ID-token `profile`: the
 * `name` claim (exactly what the nav bar shows), trimmed. Returns `null` when there
 * is no usable name — missing, not a string, or blank/whitespace — so the caller
 * records nothing and the raw `oid` stays the fallback wherever a name would show.
 */
export function displayNameFromProfile(profile: { name?: unknown }): string | null {
  const name = typeof profile.name === "string" ? profile.name.trim() : "";
  return name === "" ? null : name;
}
