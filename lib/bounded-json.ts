// Reading a JSON request body under a HARD byte cap — shared by every route that must
// buffer a body it did not originate (the public coding proxy and the teacher-only
// `/api/eval/grade`). A `Content-Length` check at the call site is only a fast reject for
// honest clients; THIS is the real bound: a chunked body that omits or understates
// Content-Length is streamed here and aborted the moment it crosses the cap, so it can
// never be buffered unbounded into memory.
//
// Transport-neutral on purpose: it returns a status + message + optional OpenAI-style
// error `code` and lets the caller shape its own error body (the coding proxy answers
// the OpenAI error envelope, the bearer channel answers `{ message }`).

export type BoundedJsonResult =
  | { ok: true; value: Record<string, unknown> }
  | { ok: false; status: number; message: string; code: string | null };

export async function readBoundedJson(req: Request, maxBytes: number): Promise<BoundedJsonResult> {
  const tooLarge = {
    ok: false as const,
    status: 413,
    message: "Request body is too large.",
    code: "request_too_large",
  };
  const notObject = {
    ok: false as const,
    status: 400,
    message: "Request body must be a JSON object.",
    code: null,
  };

  if (!req.body) return notObject;
  const reader = req.body.getReader();
  const decoder = new TextDecoder();
  let text = "";
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        return tooLarge;
      }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
  } catch {
    return notObject;
  }

  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return notObject;
  }
  if (typeof json !== "object" || json === null || Array.isArray(json)) return notObject;
  return { ok: true, value: json as Record<string, unknown> };
}
