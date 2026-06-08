import { scchModels } from "@/app/mastra/scch";

// Exposes the SCCH chat models to the browser for the dropdown. Only `id`
// (the agentId) and `label` are sent — the base URL and API key stay server-side.
export function GET() {
  return Response.json(scchModels.map(({ id, label }) => ({ id, label })));
}
