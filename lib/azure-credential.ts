import {
  AzureCliCredential,
  ChainedTokenCredential,
  ManagedIdentityCredential,
  type TokenCredential,
} from "@azure/identity";
import sql from "mssql";

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

// The ONE way this app authenticates against Azure Cognitive Services — today the
// Azure Foundry (Azure OpenAI) endpoint used by `lib/llm/foundry-endpoint.ts`. Same
// explicit chain as the data-store credential (and the same reason to avoid
// `DefaultAzureCredential` — see above), but WITHOUT the `STORAGE_TENANT_ID` pin:
// the Foundry resource lives in the `az login` identity's ambient tenant, not the
// data-store tenant.
//
// SERVER-ONLY: handles Azure credentials. Never import from client components.
export function buildCognitiveServicesCredential(): TokenCredential {
  return new ChainedTokenCredential(new AzureCliCredential({}), new ManagedIdentityCredential());
}

// Parses `MSSQL_CONNECTION_STRING` into a node-mssql config and picks the auth
// mode — the ONE place that decides how the app authenticates against its SQL
// Azure database, so the Mastra store, the Drizzle pool, and the e2e helper can
// never drift. Both pools share this "parse, then choose auth" pattern.
//
// Two modes are supported, chosen from the connection string itself:
//  1. SQL auth — the string carries `User ID=...;Password=...` (node-mssql parses
//     these into `config.user`/`config.password`). We leave the config untouched
//     so tedious uses classic SQL Server login.
//  2. Microsoft Entra ID (passwordless) — no SQL credentials in the string. We
//     attach the explicit data-store credential chain via tedious's
//     `token-credential` type: a `TokenCredential` *object* (NOT a pre-fetched
//     token), so tedious calls `getToken()` per pooled connection and tokens
//     auto-refresh. node-mssql's parser does not understand the ADO.NET
//     `Authentication=...` keyword, which is why Entra is wired up here in code.
//
// SERVER-ONLY: may build Azure credentials. Never import from client components.
export function buildMssqlConnectionConfig(
  connectionString: string,
): ReturnType<typeof sql.ConnectionPool.parseConnectionString> {
  const config = sql.ConnectionPool.parseConnectionString(connectionString);
  // SQL auth wins only when the string supplies BOTH a username and a password;
  // otherwise fall back to passwordless Entra ID.
  if (!config.user || !config.password) {
    config.authentication = {
      type: "token-credential",
      options: { credential: buildDataStoreCredential() },
    };
  }
  return config;
}
