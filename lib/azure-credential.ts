import {
  AzureCliCredential,
  ChainedTokenCredential,
  ManagedIdentityCredential,
  type TokenCredential,
} from "@azure/identity";

// The ONE way this app authenticates against its data store — the Azure SQL DB,
// reached through two pools: Mastra's (app/mastra/index.ts) and the app's own
// Drizzle pool for the novedu_* tables (lib/db/index.ts). The DB lives in the
// `STORAGE_TENANT_ID` tenant.
//
// The chain is built EXPLICITLY rather than using `DefaultAzureCredential`: that
// one would pick up `AZURE_TENANT_ID`/`AZURE_CLIENT_ID`/`AZURE_CLIENT_SECRET` via
// its `EnvironmentCredential` — but this app sets those for *user sign-in*
// (auth.ts), in a *different* tenant than the data stores — and would
// authenticate as the wrong service principal ("server is not configured to
// accept this token"). This chain ignores those vars.
//
// SERVER-ONLY: handles Azure credentials. Never import from client components.
export function buildDataStoreCredential(): TokenCredential {
  const tenantId = process.env.STORAGE_TENANT_ID;
  return new ChainedTokenCredential(
    // Local dev: the `az login` identity, pinned to the data-store tenant
    // (optional — if unset, the az credential uses its ambient default tenant).
    // Succeeds first, so the Managed Identity below is never reached off Azure.
    new AzureCliCredential(tenantId ? { tenantId } : {}),
    // On Azure: the app's system-assigned Managed Identity (the `az` CLI is
    // absent there, so the CLI credential fails fast and the chain falls
    // through). For a *user-assigned* identity instead, pass
    // `{ clientId: "<identity-client-id>" }` here.
    new ManagedIdentityCredential(),
  );
}
