import { RequestContext } from "@mastra/core/request-context";
import { WritingSaversList } from "@/app/[code]/_writing/writing-review";
import { ConversationStats } from "@/app/codes/[code]/conversation-stats";
import { WRITING_INSTRUCTIONS, WRITING_MODEL } from "@/app/mastra/writing-agents";
import { fileValidators } from "@/lib/file-validators";
import { loadWriting } from "@/lib/writing-fetch";
import type { CodeModuleDef } from "./registry";

// The writing module: a Markdown editor whose feedback chat's system prompt +
// model come from the writing YAML at the code's `file_url` (re-loaded
// server-side, never trusted from the client). The agent has no write/edit tool,
// so it can never mutate the student's text — the only persistence is the
// student's own Save (lib/writing-actions.ts), gated by the code + session oid.
//
// The teacher detail inverts the usual emphasis: for an attributed code it is the
// SAVERS LIST (WritingSaversList — saved text first, chat second); an anonymous
// writing code disables saving, so it has no savers and falls back to the shared
// ConversationStats. Both are server components called here as plain functions, so
// no JSX lives in this server-only .ts file.

export const writingModule: CodeModuleDef = {
  fileKind: "writing",
  validateOnCreate: (fileUrl, fetcher) => fileValidators.writing.validate(fileUrl, fetcher),
  runtime: {
    agentId: "writing",
    async buildRequestContext(entry) {
      const loaded = await loadWriting(entry.fileUrl);
      if (!loaded.ok) return { ok: false, status: 502, message: loaded.message };
      const context = new RequestContext();
      context.set(WRITING_INSTRUCTIONS, loaded.writing.instructions);
      context.set(WRITING_MODEL, loaded.writing.model);
      return { ok: true, context };
    },
  },
  renderDetail: (entry, searchParams) =>
    entry.anonymous
      ? ConversationStats({ entry })
      : WritingSaversList({
          code: entry.code,
          search: typeof searchParams.q === "string" ? searchParams.q : undefined,
        }),
};
