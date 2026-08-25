import { CodingDetail } from "@/app/[code]/_coding/coding-detail";
import type { CodeModuleDef } from "./registry";

// The coding module: an OpenAI-compatible coding endpoint backed by a model on
// SCCH, with a teacher-authored system prompt. Unlike the chat-based modules it has
// NO CopilotKit runtime — students reach it only through the public /api/coding/v1
// route, authenticated by a personal per-user key from `novedu_coding_keys` (see
// app/api/coding/v1/chat/completions/route.ts, lib/coding-key-store.ts). It is
// always anonymous (no in-app conversations to attribute); authoring validation is
// the strict schema gate in lib/coding-validate.ts. The teacher detail shows the
// resolved config, the teacher's own connection details, and the issued-keys list —
// there are no conversations to review. The create/edit-screen result is the
// standard share link (the registry default), like every other module.
//
// SERVER-ONLY. Calls the CodingDetail server component as a plain function so no
// JSX lives in this registry .ts file.
export const codingModule: CodeModuleDef = {
  fileKind: "coding",
  // No `runtime`: the CopilotKit route rejects any module without one.
  renderDetail: (entry) => CodingDetail({ entry }),
};
