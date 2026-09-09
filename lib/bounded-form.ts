// Reading a `multipart/form-data` request body under a HARD byte cap — the
// multipart sibling of `readBoundedJson` (lib/bounded-json.ts), used by the
// bearer image upload. A `Content-Length` check at the call site is only a fast
// reject for honest clients; THIS is the real bound: a chunked body that omits
// or understates Content-Length is streamed here and abandoned the moment it
// crosses the cap, so it can never be buffered unbounded into memory.
//
// Parsing itself is the platform's own multipart reader
// (`new Response(buffer, …).formData()`) over the BOUNDED buffer — no multipart
// dependency, and `request.formData()` (which is unbounded) is never called.
// Never throws: a malformed body is a 400, an oversized one a 413.

export type BoundedFormResult =
  | { ok: true; form: FormData }
  | { ok: false; status: 400 | 413; message: string };

export async function readBoundedFormData(
  req: Request,
  maxBytes: number,
): Promise<BoundedFormResult> {
  const notMultipart = {
    ok: false as const,
    status: 400 as const,
    message: "The request body must be multipart/form-data.",
  };
  const malformed = {
    ok: false as const,
    status: 400 as const,
    message: "The request body is not valid multipart/form-data.",
  };
  const tooLarge = {
    ok: false as const,
    status: 413 as const,
    message: "Request body is too large.",
  };

  const contentType = req.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().startsWith("multipart/form-data")) return notMultipart;
  if (!req.body) return malformed;

  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
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
      chunks.push(value);
    }
  } catch {
    return malformed;
  }

  const buffer = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    buffer.set(chunk, offset);
    offset += chunk.byteLength;
  }

  try {
    // A missing or truncated boundary makes this throw a TypeError — a 400,
    // never a 500.
    const form = await new Response(buffer, {
      headers: { "content-type": contentType },
    }).formData();
    return { ok: true, form };
  } catch {
    return malformed;
  }
}
