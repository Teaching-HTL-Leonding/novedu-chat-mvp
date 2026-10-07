import { sql } from "drizzle-orm";
import {
  buildConversation,
  type Cursor,
  type ExportConversation,
  type ExportRow,
  encodeCursor,
  MAX_MESSAGES_PER_CONVERSATION,
} from "@/lib/conversation-export";
import { getDb } from "@/lib/db";

// The read behind the conversation export (`GET /api/codes/<code>/conversations`,
// docs/api.md): one cursor page of a code's conversations, oldest thread first.
//
// RAM is the design constraint. Statement 1 picks the page's threads without
// reading any `content`; statement 2 reads the content of exactly those threads
// (at most their last `MAX_MESSAGES_PER_CONVERSATION` messages each),
// with every stored photo replaced INSIDE Postgres by a `{ type: "file",
// mimeType, bytes }` placeholder — the base64 never reaches Node.
//
// No identity, ever: this store reads ONLY `mastra.mastra_threads` /
// `mastra.mastra_messages` — never `novedu_user_chats` or `novedu_user`
// (guard-tested). Mastra tables are read with raw by-value SQL, never declared to
// Drizzle (lib/code-stats-store.ts explains why).
//
// SERVER-ONLY: uses the database. Never import from client components or the CLI.

export interface ConversationPage {
  conversations: ExportConversation[];
  /** The position after this page's last thread, or `null` when the walk is done. */
  nextCursor: string | null;
}

/**
 * One page of `code`'s conversations — threads with ≥ 1 user message (the
 * "interaction" definition of `getCodeStats`), ordered by thread `createdAt`,
 * then id, starting after `after`. `nextCursor` comes from the page's last
 * qualifying THREAD, so a page may hold fewer than `limit` conversations (a
 * thread whose messages all map away is dropped) and still carry a cursor.
 * Returns `undefined` on a database error (incl. a row whose content is not
 * JSON). Never throws.
 */
export async function listConversationPage(
  code: string,
  options: { after?: Cursor; limit: number },
): Promise<ConversationPage | undefined> {
  const { after, limit } = options;
  try {
    const afterClause = after
      ? sql`AND (t."createdAt", t.id) > (${after.createdAt}::timestamp, ${after.id})`
      : sql``;
    // Raw `execute()` rows are NOT run through drizzle's column mappers — the
    // thread timestamp is rendered as exact text (the cursor needs microseconds
    // and no timezone shift), message timestamps arrive as wire strings.
    const threadRes = await getDb().execute<{ id: string; createdAt: string }>(sql`
      SELECT t.id, to_char(t."createdAt", 'YYYY-MM-DD"T"HH24:MI:SS.US') AS "createdAt"
      FROM mastra.mastra_threads t
      WHERE t."resourceId" = ${code}
        ${afterClause}
        AND EXISTS (
          SELECT 1 FROM mastra.mastra_messages m
          WHERE m.thread_id = t.id AND m.role = 'user'
        )
      ORDER BY t."createdAt", t.id
      LIMIT ${limit + 1}
    `);
    const threads = threadRes.rows.slice(0, limit);
    const lastThread = threads[threads.length - 1];
    const nextCursor =
      threadRes.rows.length > limit && lastThread
        ? encodeCursor({ createdAt: lastThread.createdAt, id: lastThread.id })
        : null;
    if (threads.length === 0) return { conversations: [], nextCursor };

    const inList = sql.join(
      threads.map((thread) => sql`${thread.id}`),
      sql`, `,
    );
    // Only each thread's LAST `MAX_MESSAGES_PER_CONVERSATION + 1` user/assistant
    // rows are read (the window picks ids before any content is touched), so one
    // huge thread cannot exhaust memory; the extra row signals truncation.
    // Photos are stripped here: a `file` part keeps only its MIME type (stored,
    // or parsed from the data: URL) and the DECODED size of its base64 payload
    // (length * 3/4 minus the '=' padding). Every other part passes through.
    const messageRes = await getDb().execute<{
      threadId: string;
      role: string;
      createdAt: string;
      content: string;
    }>(sql`
      SELECT m.thread_id AS "threadId", m.role, m."createdAtZ" AS "createdAt",
        jsonb_build_object('parts', COALESCE((
          SELECT jsonb_agg(
            CASE WHEN e.p->>'type' = 'file' THEN jsonb_build_object(
              'type', 'file',
              'mimeType', COALESCE(
                e.p->>'mimeType',
                NULLIF(split_part(split_part(e.p->>'data', ';', 1), ':', 2), '')
              ),
              'bytes', CASE WHEN e.p->>'data' LIKE 'data:%;base64,%' THEN
                (length(d.b64) * 3) / 4 - (length(d.b64) - length(rtrim(d.b64, '=')))
              END
            ) ELSE e.p END
            ORDER BY e.ord)
          FROM jsonb_array_elements(
            CASE WHEN jsonb_typeof((m.content::jsonb)->'parts') = 'array'
              THEN (m.content::jsonb)->'parts' ELSE '[]'::jsonb END
          ) WITH ORDINALITY AS e(p, ord)
          CROSS JOIN LATERAL (SELECT split_part(e.p->>'data', ',', 2) AS b64) AS d
        ), '[]'::jsonb))::text AS content
      FROM (
        SELECT ranked.id FROM (
          SELECT k.id, ROW_NUMBER() OVER (
            PARTITION BY k.thread_id ORDER BY k."createdAtZ" DESC, k.id DESC
          ) AS rn
          FROM mastra.mastra_messages k
          WHERE k.thread_id IN (${inList})
            AND k.role IN ('user', 'assistant')
        ) ranked
        WHERE ranked.rn <= ${MAX_MESSAGES_PER_CONVERSATION + 1}
      ) kept
      JOIN mastra.mastra_messages m ON m.id = kept.id
      ORDER BY m.thread_id, m."createdAtZ", m.id
    `);

    const rowsByThread = new Map<string, ExportRow[]>();
    for (const row of messageRes.rows) {
      const rows = rowsByThread.get(row.threadId) ?? [];
      rows.push({ role: row.role, createdAt: new Date(row.createdAt), content: row.content });
      rowsByThread.set(row.threadId, rows);
    }
    const conversations = threads
      .map((thread) => buildConversation(thread.id, rowsByThread.get(thread.id) ?? []))
      .filter((conversation): conversation is ExportConversation => conversation !== null);
    return { conversations, nextCursor };
  } catch (error) {
    console.error("conversation-export-store: loading a conversation page failed", error);
    return undefined;
  }
}
