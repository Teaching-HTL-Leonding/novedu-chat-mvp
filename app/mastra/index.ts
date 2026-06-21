import { Mastra } from "@mastra/core/mastra";
import { PinoLogger } from "@mastra/loggers";
import { MSSQLStore } from "@mastra/mssql";
import sql from "mssql";
import { buildMssqlConnectionConfig } from "@/lib/azure-credential";
import { quizDiscussionAgent, quizEvaluatorAgent } from "./quiz-agents";
import { tutorAgent } from "./tutor-agent";

const logger = new PinoLogger({ name: "Mastra", level: "info" });

// Build the Azure SQL store from the connection string in `MSSQL_CONNECTION_STRING`.
//
// `buildMssqlConnectionConfig` parses the string for host/database/encrypt and
// chooses the auth mode from the string itself: classic SQL user/password when
// present, otherwise passwordless Microsoft Entra ID. The auth seam lives in one
// place (`lib/azure-credential.ts`); see the invariant there.
function buildMssqlStore(connectionString: string): MSSQLStore {
  const config = buildMssqlConnectionConfig(connectionString);
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
  //
  // The quiz agents share the same store. `quizDiscussion` is reached through the
  // CopilotKit route (agentId="quizDiscussion") for the per-question discussion
  // chat; the route's quiz branch allows ONLY that agent id. `quizEvaluator` is
  // invoked server-side by the `submitAnswer` action (never through the route —
  // the route never allows its id), so the grader is never web-exposed.
  agents: {
    tutor: tutorAgent,
    quizDiscussion: quizDiscussionAgent,
    quizEvaluator: quizEvaluatorAgent,
  },
  // Persistent storage is Azure SQL (Microsoft SQL Server) via `@mastra/mssql`,
  // authenticated with SQL user/password or Microsoft Entra ID depending on the
  // connection string. Undefined when no connection string is configured (see above).
  storage: globalForStore.mastraStore,
  logger,
});
