import { Mastra } from "@mastra/core/mastra";
import { SamplingStrategyType } from "@mastra/core/observability";
import { InMemoryDB, WorkflowsInMemory } from "@mastra/core/storage";
import { PinoLogger } from "@mastra/loggers";
import { MSSQLStore } from "@mastra/mssql";
import { Observability } from "@mastra/observability";
import sql from "mssql";
import { buildMssqlConnectionConfig } from "@/lib/azure-credential";
import { USAGE_CODE, USAGE_MODULE, USAGE_USER_ID } from "@/lib/usage-context-keys";
import { evalJudgeAgent, evalTutorAgent } from "./eval-agents";
import { quizDiscussionAgent, quizEvaluatorAgent } from "./quiz-agents";
import { tutorAgent } from "./tutor-agent";
import { usageExporter } from "./usage-exporter";
import { writingAgent } from "./writing-agents";

const logger = new PinoLogger({ name: "Mastra", level: "info" });

// Build the Azure SQL store from the connection string in `MSSQL_CONNECTION_STRING`.
//
// `buildMssqlConnectionConfig` parses the string for host/database/encrypt and
// chooses the auth mode from the string itself: classic SQL user/password when
// present, otherwise passwordless Microsoft Entra ID. The auth seam lives in one
// place (`lib/azure-credential.ts`); see the invariant there.
function buildMssqlStore(connectionString: string): MSSQLStore {
  const config = buildMssqlConnectionConfig(connectionString);
  const store = new MSSQLStore({ id: "mastra-storage", pool: new sql.ConnectionPool(config) });
  // Keep agentic-loop workflow snapshots OUT of SQL: every agent run persists a
  // "pending" snapshot at start (and deletes it at the end), and that snapshot
  // inlines the full input — with photo answers that's megabytes of base64,
  // which times out the write on the small Azure SQL tier before the LLM is
  // even called. Nothing here resumes workflows (no suspend/approval flows), so
  // the snapshots are transient scratch state; swapping the workflows domain to
  // Mastra's in-memory store is the same substitution Mastra itself makes when
  // a composite store lacks the domain. Threads/messages stay in SQL untouched.
  store.stores.workflows = new WorkflowsInMemory({ db: new InMemoryDB() });
  return store;
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

// Create Mastra's own `mastra_*` tables. `MSSQLStore` auto-initializes them, but
// only LAZILY — on the store's first use, i.e. the first agent run. That is too
// late for us: `lib/code-stats-store.ts` reads `mastra_threads` / `mastra_messages`
// directly (the by-value join model in docs/codes.md), so on a database where no
// agent has run yet a teacher opening a code detail page hits "Invalid object
// name" and the stats panel degrades to "Stats temporarily unavailable".
// instrumentation.ts therefore calls this at startup, right after the Drizzle
// migrations, so the boot contract stays "every table this server reads exists
// once startup finishes". Failures propagate for the same reason migration
// failures do.
export async function initMastraStorage(): Promise<void> {
  await globalForStore.mastraStore?.init();
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
  //
  // The `writing` agent backs the Writing feature's feedback chat (agentId="writing"
  // through the runtime route); it is configured per request from the writing YAML
  // and has no write/edit tool, so it can never mutate the student's text.
  //
  // `evalJudge` and `evalTutor` are the other internal-only agents: the first audits a
  // model's output for the teacher-only `POST /api/eval/judge`, the second generates the
  // ONE tutor turn a tutor eval measures for `POST /api/eval/respond`
  // (docs/cli-eval.md). Like `quizEvaluator`, the runtime route never allows their ids,
  // so neither is ever web-reachable by students.
  agents: {
    tutor: tutorAgent,
    quizDiscussion: quizDiscussionAgent,
    quizEvaluator: quizEvaluatorAgent,
    evalJudge: evalJudgeAgent,
    evalTutor: evalTutorAgent,
    writing: writingAgent,
  },
  // Persistent storage is Azure SQL (Microsoft SQL Server) via `@mastra/mssql`,
  // authenticated with SQL user/password or Microsoft Entra ID depending on the
  // connection string. Undefined when no connection string is configured (see above).
  storage: globalForStore.mastraStore,
  logger,
  // Usage metering: one observability instance whose only exporter meters token
  // usage + tool calls into our SQL tables (lib/usage-store.ts). `default:
  // { enabled: false }` keeps Mastra's built-in storage/platform exporters out — we
  // only want ours. `requestContextKeys` snapshots the three attribution keys the
  // seams set (the CopilotKit route's `built.context`; the quiz grader's
  // RequestContext) onto every span for the exporter to read. The auto-applied
  // SensitiveDataFilter is left on (privacy-safe default); it uses EXACT field-name
  // matching and only touches attributes/metadata/input/output, so these three keys
  // survive. See docs/usage-metering.md.
  observability: new Observability({
    default: { enabled: false },
    configs: {
      usage: {
        serviceName: "novedu-usage",
        sampling: { type: SamplingStrategyType.ALWAYS },
        requestContextKeys: [USAGE_CODE, USAGE_USER_ID, USAGE_MODULE],
        exporters: [usageExporter],
      },
    },
  }),
});
