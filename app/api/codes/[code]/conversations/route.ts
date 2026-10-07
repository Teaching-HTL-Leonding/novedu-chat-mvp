import { ApiAuthError, requireBearerTeacher } from "@/lib/api-auth";
import { getCode } from "@/lib/code-store";
import { type ConversationPageWire, type Cursor, decodeCursor } from "@/lib/conversation-export";
import { listConversationPage } from "@/lib/conversation-export-store";
import { emitEvent, recordError } from "@/lib/telemetry";
import { authErrorResponse, json } from "../../../shared";

// CLI/API bearer route for the conversation export (docs/api.md "Pagination",
// docs/codes.md): one cursor page of every conversation students had under ONE
// code, for a teacher to hand to an LLM. CREATOR-ONLY — stricter than the
// role-gated web transcript pages: the bearer teacher must be the code's
// `created_by`. The export carries no identity for any code, and photos arrive as
// `{ type: "image", mimeType, bytes }` placeholders (lib/conversation-export-store.ts).
// Rides the existing `api/codes` exclusion in proxy.ts; requireBearerTeacher is
// the gate. NOT a checkCode() site — the caller is a teacher, not a student.
export const dynamic = "force-dynamic";

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 50;

const BAD_LIMIT = { message: `limit must be an integer from 1 to ${MAX_LIMIT}.` };
const BAD_CURSOR = { message: "after is not a valid cursor." };
const NOT_FOUND = { message: "No code with that name." };
const NOT_CREATOR = { message: "Only the code's creator can export its conversations." };
const UNAVAILABLE = {
  message: "Conversations could not be loaded right now. Try again in a moment.",
};

function parseLimit(raw: string | null): number | null {
  if (raw === null) return DEFAULT_LIMIT;
  if (!/^\d{1,3}$/.test(raw)) return null;
  const limit = Number(raw);
  return limit >= 1 && limit <= MAX_LIMIT ? limit : null;
}

export async function GET(request: Request, { params }: { params: Promise<{ code: string }> }) {
  try {
    const user = await requireBearerTeacher(request);
    const { code } = await params;
    const search = new URL(request.url).searchParams;

    // Input is validated before any database round trip.
    const limit = parseLimit(search.get("limit"));
    if (limit === null) return json(BAD_LIMIT, 400);
    const rawAfter = search.get("after");
    let after: Cursor | undefined;
    if (rawAfter !== null) {
      const decoded = decodeCursor(rawAfter);
      if (decoded === null) return json(BAD_CURSOR, 400);
      after = decoded;
    }

    // Existence is not secret (`GET /api/codes?mine=0` lists every code), so an
    // unknown code is a 404 and someone else's a 403.
    const entry = await getCode(code);
    if (entry === undefined) return json(UNAVAILABLE, 503);
    if (entry === null) return json(NOT_FOUND, 404);
    if (entry.createdBy !== user.userId) return json(NOT_CREATOR, 403);

    const page = await listConversationPage(entry.code, { after, limit });
    if (page === undefined) return json(UNAVAILABLE, 503);

    // Ids and counts only — never content.
    emitEvent("conversations.export.page", {
      code: entry.code,
      limit,
      returned: page.conversations.length,
    });
    const body: ConversationPageWire = {
      code: {
        code: entry.code,
        module: entry.module,
        note: entry.note === "" ? null : entry.note,
        fileUrl: entry.fileUrl,
        anonymous: entry.anonymous,
      },
      conversations: page.conversations,
      nextCursor: page.nextCursor,
    };
    return json(body, 200);
  } catch (error) {
    if (error instanceof ApiAuthError) return authErrorResponse(error);
    recordError(error, { "novedu.area": "api-codes-export" });
    return json({ message: "Internal server error" }, 500);
  }
}
