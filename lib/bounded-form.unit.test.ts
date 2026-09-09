// @vitest-environment node
import { describe, expect, it } from "vitest";
import { readBoundedFormData } from "@/lib/bounded-form";

// The bounded multipart reader behind the bearer image upload. Real wire bodies
// throughout (a `Request` built from `FormData` produces the actual multipart
// bytes and boundary), because the point of this module is what happens to REAL
// bytes: the cap is enforced by counting them, not by trusting Content-Length,
// and a body that never parses must be a 400 rather than a throw.

const MAX = 1024;

function multipartRequest(form: FormData): Request {
  return new Request("http://localhost/api/images/diagram", { method: "POST", body: form });
}

/** A chunked body with NO Content-Length — the shape the counter must catch. */
function chunkedRequest(chunkCount: number, chunkSize: number, contentType: string): Request {
  // Pull-based on purpose: the reader stops asking as soon as the cap is hit, so
  // the remaining chunks are never produced.
  let sent = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (sent >= chunkCount) {
        controller.close();
        return;
      }
      sent++;
      controller.enqueue(new Uint8Array(chunkSize));
    },
  });
  return new Request("http://localhost/api/images/diagram", {
    method: "POST",
    body: stream,
    headers: { "content-type": contentType },
    duplex: "half",
  } as RequestInit & { duplex: "half" });
}

describe("readBoundedFormData", () => {
  it("parses a real multipart body into its fields", async () => {
    const form = new FormData();
    form.set("file", new File([new Uint8Array([1, 2, 3])], "red.png", { type: "image/png" }));
    form.set("mime", "image/png");
    form.set("credit", "CC BY 4.0");

    const result = await readBoundedFormData(multipartRequest(form), MAX);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const file = result.form.get("file");
    expect(file).toBeInstanceOf(File);
    expect(new Uint8Array(await (file as File).arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]));
    expect((file as File).name).toBe("red.png");
    expect(result.form.get("mime")).toBe("image/png");
    expect(result.form.get("credit")).toBe("CC BY 4.0");
  });

  it("400s a body that is not multipart/form-data", async () => {
    const request = new Request("http://localhost/api/images/diagram", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ mime: "image/png" }),
    });
    await expect(readBoundedFormData(request, MAX)).resolves.toEqual({
      ok: false,
      status: 400,
      message: "The request body must be multipart/form-data.",
    });
  });

  it("400s a request with no content-type at all", async () => {
    const request = new Request("http://localhost/api/images/diagram", {
      method: "POST",
      body: "anything",
      headers: { "content-type": "" },
    });
    const result = await readBoundedFormData(request, MAX);
    expect(result).toMatchObject({ ok: false, status: 400 });
  });

  it("400s a multipart body whose boundary never closes", async () => {
    const request = new Request("http://localhost/api/images/diagram", {
      method: "POST",
      headers: { "content-type": "multipart/form-data; boundary=----abc" },
      body: '------abc\r\nContent-Disposition: form-data; name="mime"\r\n\r\nimage/png\r\n',
    });
    await expect(readBoundedFormData(request, MAX)).resolves.toEqual({
      ok: false,
      status: 400,
      message: "The request body is not valid multipart/form-data.",
    });
  });

  it("400s a multipart content-type with no boundary parameter", async () => {
    const request = new Request("http://localhost/api/images/diagram", {
      method: "POST",
      headers: { "content-type": "multipart/form-data" },
      body: "whatever",
    });
    const result = await readBoundedFormData(request, MAX);
    expect(result).toMatchObject({ ok: false, status: 400 });
  });

  it("accepts a body of exactly maxBytes", async () => {
    const form = new FormData();
    form.set("file", new File([new Uint8Array(64)], "x.png", { type: "image/png" }));
    const request = multipartRequest(form);
    const size = (await request.clone().arrayBuffer()).byteLength;
    expect(size).toBeGreaterThan(0);

    const result = await readBoundedFormData(request, size);
    expect(result.ok).toBe(true);
  });

  it("413s a body one byte over maxBytes", async () => {
    const form = new FormData();
    form.set("file", new File([new Uint8Array(64)], "x.png", { type: "image/png" }));
    const request = multipartRequest(form);
    const size = (await request.clone().arrayBuffer()).byteLength;

    await expect(readBoundedFormData(request, size - 1)).resolves.toEqual({
      ok: false,
      status: 413,
      message: "Request body is too large.",
    });
  });

  it("413s a chunked body that declares no Content-Length at all", async () => {
    const request = chunkedRequest(4, 512, "multipart/form-data; boundary=----abc");
    expect(request.headers.get("content-length")).toBeNull();
    await expect(readBoundedFormData(request, MAX)).resolves.toMatchObject({
      ok: false,
      status: 413,
    });
  });

  it("rejects an oversized body BEFORE parsing it", async () => {
    // The bytes are not valid multipart at all: a 413 (not the malformed 400)
    // proves the counter aborted before the parser ever saw them.
    const request = chunkedRequest(4, 512, "multipart/form-data; boundary=----abc");
    await expect(readBoundedFormData(request, 100)).resolves.toMatchObject({
      ok: false,
      status: 413,
    });
  });
});
