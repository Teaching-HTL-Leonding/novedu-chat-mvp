import { MastraAgent } from "@ag-ui/mastra";
import { CopilotRuntime, createCopilotEndpoint } from "@copilotkit/runtime/v2";
import { mastra } from "@/app/mastra";

// Identifies the memory resource (i.e. "user") that agent threads are scoped to.
// Hard-coded for the prototype — swap for a real per-user id once auth exists.
const RESOURCE_ID = "chat-prototype";

const runtime = new CopilotRuntime({
  // getLocalAgents discovers every agent registered on the Mastra instance and
  // wraps each as an in-process AG-UI agent. Keys match the registration keys in
  // app/mastra/index.ts (e.g. "weatherAgent"), which the CopilotKit frontend
  // references via the `agentId` prop.
  // @ts-expect-error - @ag-ui/mastra's AbstractAgent type does not line up with
  // the runtime's expected agent type in this beta. Known upstream issue.
  agents: MastraAgent.getLocalAgents({ mastra, resourceId: RESOURCE_ID }),
});

// createCopilotEndpoint returns a Hono app whose `.fetch` is a standard
// (Request) => Response handler. Mounted on an optional catch-all route so it
// serves both the base path and sub-routes like `/info`.
const app = createCopilotEndpoint({ runtime, basePath: "/api/copilotkit" });

const handler = (req: Request) => app.fetch(req);

export const GET = handler;
export const POST = handler;
export const OPTIONS = handler;
