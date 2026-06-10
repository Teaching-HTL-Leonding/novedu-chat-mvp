import {
  AzureCliCredential,
  ChainedTokenCredential,
  ManagedIdentityCredential,
} from "@azure/identity";
import { Mastra } from "@mastra/core/mastra";
import { PinoLogger } from "@mastra/loggers";
import { MSSQLStore } from "@mastra/mssql";
import sql from "mssql";
import { tutorAgent } from "./tutor-agent";

const logger = new PinoLogger({ name: "Mastra", level: "info" });

// Build the Azure SQL store from the connection string in `MSSQL_CONNECTION_STRING`.
//
// We parse the string for the host/database/encrypt settings but supply the auth
// ourselves, for two reasons:
//  1. node-mssql does NOT understand the ADO.NET keyword
//     `Authentication="Active Directory Default"` (its parser only knows "Active
//     Directory Integrated"/"...Password"), so left alone it falls back to SQL auth.
//  2. We want Entra ID auth with no SQL password, passed via tedious's
//     `token-credential` (which lets tedious call `getToken()` per pooled connection,
//     so tokens auto-refresh).
//
// We build the credential chain EXPLICITLY rather than using `DefaultAzureCredential`:
// that one would pick up `AZURE_TENANT_ID`/`AZURE_CLIENT_ID`/`AZURE_CLIENT_SECRET` via
// its `EnvironmentCredential` — but this app sets those for *user sign-in* (auth.ts),
// in a *different* tenant than the SQL database — and would authenticate as the wrong
// service principal ("server is not configured to accept this token"). This chain
// ignores those vars:
//   - locally: the `az login` identity, in the SQL DB's tenant (`MSSQL_TENANT_ID`);
//   - on Azure: the app's Managed Identity (the `az` CLI is absent there, so the CLI
//     credential fails fast and the chain falls through to it).
function buildMssqlStore(connectionString: string): MSSQLStore {
  const config = sql.ConnectionPool.parseConnectionString(connectionString);

  const tenantId = process.env.MSSQL_TENANT_ID;
  const credential = new ChainedTokenCredential(
    // Local dev: the `az login` identity (in the SQL DB's tenant). Succeeds first, so
    // the Managed Identity below is never reached off Azure — no client id needed.
    new AzureCliCredential(tenantId ? { tenantId } : {}),
    // On Azure: the app's system-assigned Managed Identity. (For a *user-assigned*
    // identity instead, pass `{ clientId: "<identity-client-id>" }` here.)
    new ManagedIdentityCredential(),
  );
  config.authentication = { type: "token-credential", options: { credential } };

  return new MSSQLStore({ id: "mastra-storage", pool: new sql.ConnectionPool(config) });
}

// Reuse a single store (and its connection pool) across Next.js HMR reloads in dev,
// otherwise every hot reload would leak a new pool. In production the module is
// evaluated once, so this is just a no-op cache.
const globalForStore = globalThis as unknown as { mastraStore?: MSSQLStore };

const connectionString = process.env.MSSQL_CONNECTION_STRING;
if (connectionString && !globalForStore.mastraStore) {
  globalForStore.mastraStore = buildMssqlStore(connectionString);
} else if (!connectionString) {
  // The app still boots (non-chat flows like tutor validation work without a DB),
  // but the tutor's Memory REQUIRES a store — chatting will fail until a connection
  // string is set. We don't degrade gracefully; that surfaces as a server error.
  logger.warn("MSSQL_CONNECTION_STRING not set — tutor chat will fail without storage");
}

export const mastra = new Mastra({
  // The `tutor` agent is configured per request from a tutor-definition YAML
  // (system prompt + model) and persists its conversation via the shared store.
  // NOTE: the registry KEY (not the agent's `id`) is the AG-UI agentId the
  // frontend references — so this must be `tutor` to match `agentId="tutor"`.
  agents: { tutor: tutorAgent },
  // Persistent storage is Azure SQL (Microsoft SQL Server) via `@mastra/mssql`,
  // authenticated with Microsoft Entra ID. Undefined when no connection string is
  // configured (see above).
  storage: globalForStore.mastraStore,
  logger,
});
