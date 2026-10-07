import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { mintSessionToken } from "./api-auth.utils";
import { deleteCode, mintTutorCode, VALID_TUTOR_URL } from "./code.utils";
import { query } from "./db";

// The conversation export route over REAL HTTP and the REAL SQL: the creator-only
// gate (a code minted through `POST /api/codes` with the teacher token is theirs;
// `mintTutorCode`'s `e2e-test-suite` code is not), the cursor walk, the
// "≥ 1 user message" filter, and the in-Postgres photo stripping (a real data:
// URL goes in, only `{ mimeType, bytes }` comes out). Conversations are seeded
// straight into the Mastra tables — no LLM involved, hence @live-db.

test.setTimeout(120_000);
test.use({ storageState: { cookies: [], origins: [] } });

// A real 1×1 PNG; its base64 ends in "==" padding, so the byte math is exercised.
const PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

let mintedCodes: string[] = [];
let seededThreads: string[] = [];

test.afterEach(async () => {
  try {
    if (seededThreads.length > 0) {
      await query(`DELETE FROM mastra.mastra_messages WHERE thread_id = ANY($1)`, [seededThreads]);
      await query(`DELETE FROM mastra.mastra_threads WHERE id = ANY($1)`, [seededThreads]);
    }
    for (const code of mintedCodes) await deleteCode(code);
  } catch (error) {
    console.error("api-conversations cleanup failed (best-effort)", error);
  } finally {
    mintedCodes = [];
    seededThreads = [];
  }
});

function iso(ms: number): string {
  return new Date(ms).toISOString();
}

async function seedThread(
  code: string,
  at: number,
  messages: Array<{ role: string; parts: unknown[] }>,
  // The exact naive `createdAt` text, when a test needs microseconds or a tie.
  threadCreatedAt?: string,
) {
  const id = randomUUID();
  seededThreads.push(id);
  const stamp = iso(at);
  await query(
    `INSERT INTO mastra.mastra_threads (id, "resourceId", title, "createdAt", "updatedAt", "createdAtZ", "updatedAtZ")
     VALUES ($1, $2, '', $3, $3, $4, $4)`,
    [id, code, threadCreatedAt ?? stamp.replace("Z", ""), stamp],
  );
  for (const [index, message] of messages.entries()) {
    const messageStamp = iso(at + (index + 1) * 100);
    await query(
      `INSERT INTO mastra.mastra_messages (id, thread_id, content, role, type, "createdAt", "createdAtZ")
       VALUES ($1, $2, $3, $4, 'v2', $5, $6)`,
      [
        randomUUID(),
        id,
        JSON.stringify({ format: 2, parts: message.parts }),
        message.role,
        messageStamp.replace("Z", ""),
        messageStamp,
      ],
    );
  }
  return id;
}

test("the creator walks every conversation page by page, photos as placeholders only", {
  tag: ["@live", "@live-db"],
}, async ({ request }) => {
  const headers = { authorization: `Bearer ${await mintSessionToken({ teacher: true })}` };

  // Code A belongs to the bearer teacher; code B to the e2e suite principal.
  const created = await request.post("/api/codes", {
    headers,
    data: { module: "tutor", fileUrl: VALID_TUTOR_URL, note: `e2e export ${Date.now()}` },
  });
  expect(created.status()).toBe(201);
  const code: string = (await created.json()).code;
  mintedCodes.push(code);
  const foreign = await mintTutorCode({ note: `e2e export foreign ${Date.now()}` });
  mintedCodes.push(foreign);

  const t0 = Date.now() - 60_000;
  const photoThread = await seedThread(code, t0, [
    {
      role: "user",
      parts: [
        { type: "text", text: "Hier mein Versuch:" },
        { type: "file", data: `data:image/png;base64,${PNG_BASE64}`, mimeType: "image/png" },
      ],
    },
    { role: "assistant", parts: [{ type: "text", text: "Sieht gut aus." }] },
  ]);
  // Assistant-only: opened but never written into — not a conversation.
  await seedThread(code, t0 + 1000, [
    { role: "assistant", parts: [{ type: "text", text: "Hallo!" }] },
  ]);
  const toolThread = await seedThread(code, t0 + 2000, [
    { role: "user", parts: [{ type: "text", text: "Gib mir eine Zahl." }] },
    {
      role: "assistant",
      parts: [
        {
          type: "tool-invocation",
          toolInvocation: {
            state: "result",
            toolCallId: "call-1",
            toolName: "random_number",
            args: { min: 1, max: 6 },
            result: { value: 4 },
          },
        },
        { type: "step-start" },
        { type: "text", text: "Deine Zahl ist 4." },
      ],
    },
  ]);

  // Paging boundaries: a thread with the SAME `createdAt` as the tool thread (the
  // tie is broken by id) and one exactly ONE MICROSECOND later — a cursor that lost
  // precision or shifted timezone would skip or repeat one of them.
  const toolStamp = iso(t0 + 2000).replace("Z", "");
  const chat = (text: string) => [
    { role: "user", parts: [{ type: "text", text }] },
    { role: "assistant", parts: [{ type: "text", text: "ok" }] },
  ];
  const tiedThread = await seedThread(code, t0 + 2000, chat("tie"), toolStamp);
  const microThread = await seedThread(code, t0 + 2000, chat("micro"), `${toolStamp}001`);
  // …and one more microsecond after it: a cursor built FROM the microsecond thread
  // that was truncated to milliseconds would repeat that thread on the next page.
  const micro2Thread = await seedThread(code, t0 + 2000, chat("micro2"), `${toolStamp}002`);

  // Walk with limit=1: one conversation per page until the cursor runs out.
  const bodies: string[] = [];
  const pages: Array<{
    code: unknown;
    conversations: Array<Record<string, unknown>>;
    nextCursor: string | null;
  }> = [];
  let after: string | null = null;
  do {
    const search = new URLSearchParams({ limit: "1" });
    if (after) search.set("after", after);
    const response = await request.get(`/api/codes/${code}/conversations?${search}`, { headers });
    expect(response.status()).toBe(200);
    expect(response.headers()["cache-control"]).toBe("no-store");
    const text = await response.text();
    bodies.push(text);
    const page = JSON.parse(text);
    pages.push(page);
    after = page.nextCursor;
  } while (after !== null && pages.length < 10);

  // Five qualifying threads (the assistant-only one is filtered in SQL) → exactly
  // five pages: each sees one more row and hands out a cursor, the last does not.
  const conversations = pages.flatMap((page) => page.conversations);
  const tied = [toolThread, tiedThread].sort();
  expect(conversations.map((c) => c.threadId)).toEqual([
    photoThread,
    ...tied,
    microThread,
    micro2Thread,
  ]);
  expect(pages).toHaveLength(5);
  expect(pages.slice(0, 4).every((page) => page.nextCursor !== null)).toBe(true);
  expect(pages[4]?.nextCursor).toBeNull();
  expect(pages[0]?.code).toMatchObject({ code, module: "tutor", anonymous: true });
  expect(conversations.every((c) => c.truncated === false)).toBe(true);

  // The photo never leaves Postgres: only its placeholder.
  const all = bodies.join("\n");
  expect(all).not.toContain("base64,");
  expect(all).not.toContain(PNG_BASE64.slice(0, 24));
  expect(conversations[0]?.messages).toEqual([
    {
      role: "user",
      createdAt: expect.any(String),
      content: [
        { type: "text", text: "Hier mein Versuch:" },
        { type: "image", mimeType: "image/png", bytes: Buffer.from(PNG_BASE64, "base64").length },
      ],
    },
    { role: "assistant", createdAt: expect.any(String), content: "Sieht gut aus." },
  ]);
  expect(conversations.find((c) => c.threadId === toolThread)?.messages).toEqual([
    { role: "user", createdAt: expect.any(String), content: "Gib mir eine Zahl." },
    {
      role: "assistant",
      createdAt: expect.any(String),
      content: [
        { type: "tool", name: "random_number", args: { min: 1, max: 6 }, result: { value: 4 } },
        { type: "text", text: "Deine Zahl ist 4." },
      ],
    },
  ]);

  // No identity anywhere.
  expect(all).not.toMatch(/"userId"|"name"\s*:\s*"E2E|"createdBy"|e2e-api-teacher/);

  // Someone else's code → 403; a malformed cursor → 400.
  expect((await request.get(`/api/codes/${foreign}/conversations`, { headers })).status()).toBe(
    403,
  );
  expect(
    (await request.get(`/api/codes/${code}/conversations?after=garbage!`, { headers })).status(),
  ).toBe(400);
});

test("a conversation over the message cap exports only its last messages, marked truncated", {
  tag: ["@live", "@live-db"],
}, async ({ request }) => {
  const headers = { authorization: `Bearer ${await mintSessionToken({ teacher: true })}` };
  const created = await request.post("/api/codes", {
    headers,
    data: { module: "tutor", fileUrl: VALID_TUTOR_URL, note: `e2e export cap ${Date.now()}` },
  });
  expect(created.status()).toBe(201);
  const code: string = (await created.json()).code;
  mintedCodes.push(code);

  // 502 alternating user/assistant messages, one second apart, in one statement.
  const total = 502;
  const t0 = Date.now() - 3_600_000;
  const id = await seedThread(code, t0, []);
  await query(
    `INSERT INTO mastra.mastra_messages (id, thread_id, content, role, type, "createdAt", "createdAtZ")
     SELECT gen_random_uuid()::text, $1,
       json_build_object('format', 2, 'parts', json_build_array(json_build_object('type', 'text', 'text', 'm' || i)))::text,
       CASE WHEN i % 2 = 0 THEN 'user' ELSE 'assistant' END, 'v2',
       ($2::timestamptz + i * interval '1 second') AT TIME ZONE 'UTC',
       $2::timestamptz + i * interval '1 second'
     FROM generate_series(0, $3 - 1) AS i`,
    [id, new Date(t0).toISOString(), total],
  );

  const response = await request.get(`/api/codes/${code}/conversations`, { headers });
  expect(response.status()).toBe(200);
  const [conversation] = (await response.json()).conversations;
  expect(conversation.threadId).toBe(id);
  expect(conversation.truncated).toBe(true);
  expect(conversation.messages).toHaveLength(500);
  expect(conversation.messages[0].content).toBe(`m${total - 500}`);
  expect(conversation.messages.at(-1).content).toBe(`m${total - 1}`);
  expect(conversation.startedAt).toBe(new Date(t0 + (total - 500) * 1000).toISOString());
});
