import { checkCode } from "@/lib/code-store";
import { CODING_MODEL_ID } from "@/lib/coding-connection";
import { errorResponse, invalidApiKey, serviceUnavailable } from "@/lib/coding-http";
import { lookupCodingKey } from "@/lib/coding-key-store";
import { parseBearerKey } from "@/lib/coding-proxy";

// PUBLIC, NON-ENTRA route (excluded from the proxy.ts gate alongside its sibling
// chat/completions): the OpenAI-conventional models list for the "coding" module,
// authenticated by the same personal `nvk-…` key and gated by the same two stored rows
// (the key row + the code row), re-verified on every request.
//
// It is the CHEAPEST authenticated call on the endpoint, which is its practical role:
// an external tool holding a stored key can prove the key still opens the activity
// without generating a completion. It therefore never contacts an upstream model — no
// YAML load, no endpoint resolution, no token acquisition, no usage metering (nothing
// was generated).
//
// It answers ONLY the generic advertised model id the connection page hands out. The
// teacher's real pinned model, the provider and the system prompt stay server-side —
// exposing them here would leak through the one surface a student's tool can reach.

export const dynamic = "force-dynamic";

// Fixed rather than request-time: the response is a constant, and a moving `created`
// would only invite callers to read meaning into it.
const CREATED = 0;

export async function GET(req: Request): Promise<Response> {
  const apiKey = parseBearerKey(req.headers.get("authorization"));
  if (!apiKey) return invalidApiKey();

  // The identical gate the completions route runs — same signals for the same states,
  // so this cheaper call cannot become an oracle the expensive one is not.
  const issued = await lookupCodingKey(apiKey);
  if (issued.status === "error") return serviceUnavailable();
  if (issued.status === "miss") return invalidApiKey();

  const verification = await checkCode(issued.code);
  if (!verification.ok) {
    switch (verification.reason) {
      case "unknown-code":
        return invalidApiKey();
      case "not-started":
      case "expired":
        return errorResponse(
          "This key is not active. It is outside its availability window.",
          403,
          "invalid_request_error",
          "key_inactive",
        );
      default:
        return serviceUnavailable();
    }
  }
  if (verification.entry.module !== "coding") return invalidApiKey();

  return Response.json(
    {
      object: "list",
      data: [{ id: CODING_MODEL_ID, object: "model", created: CREATED, owned_by: "novedu" }],
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
