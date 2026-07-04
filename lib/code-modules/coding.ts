import { CodingDetail } from "@/app/[code]/_coding/coding-detail";
import { CodingResult } from "@/app/[code]/_coding/coding-result";
import type { CodeModuleDef } from "./registry";

// The coding module: an OpenAI-compatible coding endpoint backed by a model on
// SCCH, with a teacher-authored system prompt. Unlike the chat-based modules it has
// NO CopilotKit runtime — students reach it only through the public /api/coding/v1
// route, using the CODE as the bearer API key (see
// app/api/coding/v1/chat/completions/route.ts). It is always anonymous (no
// per-student identity on the API path); authoring validation is the strict schema
// gate in lib/coding-validate.ts. The teacher detail shows the resolved config plus
// the connection details to hand out — there are no conversations to review.
//
// SERVER-ONLY. Calls the CodingDetail server component as a plain function so no
// JSX lives in this registry .ts file.
export const codingModule: CodeModuleDef = {
  fileKind: "coding",
  // No `runtime`: the CopilotKit route rejects any module without one.
  renderDetail: (entry) => CodingDetail({ entry }),
  // The create/edit-screen result is the little-coder connection config, not a share
  // link — a coding code is an API key. (`shareUrl` in ctx is intentionally unused.)
  renderResult: (entry, { origin }) => CodingResult({ entry, origin }),
};
