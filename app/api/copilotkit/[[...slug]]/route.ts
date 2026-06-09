import { MastraAgent } from "@ag-ui/mastra";
import { CopilotRuntime, createCopilotEndpoint } from "@copilotkit/runtime/v2";
import { RequestContext } from "@mastra/core/request-context";
import { mastra } from "@/app/mastra";

// Identifies the memory resource (i.e. "user") that agent threads are scoped to.
// Hard-coded for the prototype — swap for a real per-user id once auth exists.
const RESOURCE_ID = "chat-prototype";

// The chat is driven by a tutor-definition YAML. Its public URL arrives in the
// `x-tutor-url` header (set by the frontend's CopilotKitProvider once validation
// passes) and is handed to the `tutor` agent via RequestContext, where its
// dynamic `instructions`/`model` resolvers read it. (A header — not a query
// string — because CopilotKit appends sub-paths like `/info` to the runtime URL,
// which a query string would corrupt.) We build the runtime per request so each
// request carries its own context; the heavy work (fetch + assemble the YAML) is
// memoized inside the tutor agent, so this stays cheap.
function handler(req: Request): Response | Promise<Response> {
  const tutor = req.headers.get("x-tutor-url") ?? "";

  const requestContext = new RequestContext();
  requestContext.set("tutor-url", tutor);

  const runtime = new CopilotRuntime({
    // @ts-expect-error - @ag-ui/mastra's AbstractAgent type does not line up with
    // the runtime's expected agent type in this beta. Known upstream issue.
    agents: MastraAgent.getLocalAgents({ mastra, resourceId: RESOURCE_ID, requestContext }),
  });

  // createCopilotEndpoint returns a Hono app whose `.fetch` is a standard
  // (Request) => Response handler. Mounted on an optional catch-all route so it
  // serves both the base path and sub-routes like `/info`.
  const app = createCopilotEndpoint({ runtime, basePath: "/api/copilotkit" });
  return app.fetch(req);
}

export const GET = handler;
export const POST = handler;
export const OPTIONS = handler;
