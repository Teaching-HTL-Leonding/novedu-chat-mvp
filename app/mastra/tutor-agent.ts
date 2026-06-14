import { Agent } from "@mastra/core/agent";
import type { RequestContext } from "@mastra/core/request-context";
import { Memory } from "@mastra/memory";
import { defaultFetcher, loadAndBuildTutorPrompt } from "@/lib/tutors";
import { scchProvider } from "./scch";

// A single agent that is configured entirely by a tutor-definition YAML. The
// tutor's URL arrives per request via `requestContext` (set by the CopilotKit
// route after it verified the tutor code and thread token); this agent resolves its
// system prompt and model from that URL at request time using the reusable
// `lib/tutors` core.

interface LoadedTutor {
  prompt: string;
  model: string;
}

// A built prompt is NEVER cached across requests: the YAML is fetched + assembled
// fresh on every chat request. This keeps edits to a tutor YAML visible immediately
// and is forward-compatible with planned per-user parameters (which make the prompt
// user-specific, so caching it by URL would serve the wrong prompt). The only
// memoization is REQUEST-SCOPED: `instructions` and `model` both resolve per request
// and would each rebuild, so a WeakMap keyed on the per-request `requestContext` (a
// fresh object per chat request — see the CopilotKit route) shares one build between
// them, then lets it be garbage-collected with the request. The chat hot path uses
// DEFAULT load options (no `validateLibraries`); the thorough whole-library check is
// an authoring-time gate (share / validate page / CLI), not chat.
const perRequestBuild = new WeakMap<RequestContext, Promise<LoadedTutor>>();

function loadTutor(requestContext: RequestContext): Promise<LoadedTutor> {
  const inFlight = perRequestBuild.get(requestContext);
  if (inFlight) return inFlight;

  const promise = loadAndBuildTutorPrompt(tutorUrl(requestContext), defaultFetcher).then(
    (result) => {
      if (!result.ok) {
        const first = result.errors[0];
        throw new Error(
          first
            ? `Tutor validation failed (${first.code}): ${first.message}`
            : "Tutor validation failed",
        );
      }
      return { prompt: result.prompt, model: result.model };
    },
  );

  perRequestBuild.set(requestContext, promise);
  return promise;
}

function tutorUrl(requestContext: RequestContext): string {
  const url = requestContext.get("tutor-url");
  if (typeof url !== "string" || url === "") {
    throw new Error("No tutor URL provided for this chat. Load a tutor first.");
  }
  return url;
}

export const tutorAgent = new Agent({
  id: "tutor",
  name: "Tutor",
  // Both resolvers run per request and share the same request-scoped build. The
  // prompt is used verbatim — no app-level formatting guidance is appended.
  instructions: async ({ requestContext }) => (await loadTutor(requestContext)).prompt,
  model: async ({ requestContext }) => scchProvider.chat((await loadTutor(requestContext)).model),
  // Persist the conversation so the tutor remembers earlier turns. No explicit
  // storage here: Memory inherits the Mastra instance's Azure SQL store (see
  // `index.ts`), so threads/messages land in the `mastra_*` tables. The thread
  // id is server-generated per page load (app/[code]/page.tsx) and ownership-
  // checked in the CopilotKit route, which also sets the resource id (the
  // tutor code — threads group per code, see docs/tutor-codes.md). `semanticRecall`
  // is disabled — it would require a vector store + embedder we don't run; plain
  // recent-message history is all the tutor needs.
  //
  // NOTE: `Memory` REQUIRES a storage provider — if `MSSQL_CONNECTION_STRING` is
  // unset, the instance has no store and a tutor chat fails ("Memory requires a
  // storage provider"). That's acceptable: storage is effectively required to chat.
  memory: new Memory({
    options: {
      lastMessages: 20,
      semanticRecall: false,
    },
  }),
});
