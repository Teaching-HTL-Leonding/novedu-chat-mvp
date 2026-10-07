import { open, rm } from "node:fs/promises";
import type { Writable } from "node:stream";
import { finished } from "node:stream/promises";
import { type ConversationPageWire, EXPORT_FORMAT } from "@/lib/conversation-export";
import { failJson, performApiRequest, printJson } from "./api";

// `novedu-cli codes export <code>` (docs/api.md): walks the creator-only, cursor-
// paged `GET /api/codes/<code>/conversations` and streams it as JSONL — one header
// line (`format: novedu-conversations/1`), then one line per conversation as the
// pages arrive. Constant memory: one page in flight.
//
// The third exception to the JSON-only output rule (beside `codes sync` and
// `eval`): without --out, stdout carries ONLY the JSONL stream, so `> file.jsonl`
// and `| jq -c` work; with --out the stream goes to the file and stdout gets the
// usual JSON summary. Failures stay JSON on stderr with exit 1. In stdout mode
// lines already written stay written; in --out mode the partial file is removed.

/** The server's page cap — the CLI always asks for full pages. */
const PAGE_SIZE = 50;

export interface ExportOptions {
  server?: string;
  out?: string;
}

// The envelope is checked before any of the page is written: a malformed answer
// never reaches the output (nor the summary's counts). The conversations
// themselves pass through as the server sent them.
function isPage(value: unknown): value is ConversationPageWire {
  if (value === null || typeof value !== "object") return false;
  const page = value as Record<string, unknown>;
  const block = page.code as Record<string, unknown> | null | undefined;
  return (
    block !== null &&
    typeof block === "object" &&
    typeof block.code === "string" &&
    Array.isArray(page.conversations) &&
    page.conversations.every(
      (c) =>
        c !== null &&
        typeof c === "object" &&
        Array.isArray((c as { messages?: unknown }).messages),
    ) &&
    (page.nextCursor === null || typeof page.nextCursor === "string")
  );
}

// A closed pipe (`| head`) is the reader's choice, not a failure.
function isBrokenPipe(error: unknown): boolean {
  return (error as NodeJS.ErrnoException | undefined)?.code === "EPIPE";
}

// Resolves on 'drain'; rejects on 'error' or 'close' — a stream that died while
// its buffer was full never drains, and waiting for it would hang the export.
function drained(stream: Writable): Promise<void> {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      stream.off("drain", onDrain);
      stream.off("error", onError);
      stream.off("close", onClose);
    };
    const onDrain = () => {
      cleanup();
      resolve();
    };
    const onError = (error: unknown) => {
      cleanup();
      reject(error);
    };
    const onClose = () => {
      cleanup();
      reject(Object.assign(new Error("the output was closed"), { code: "EPIPE" }));
    };
    stream.on("drain", onDrain);
    stream.on("error", onError);
    stream.on("close", onClose);
  });
}

export async function runConversationExport(code: string, options: ExportOptions): Promise<void> {
  const { out } = options;
  let sink: Writable;
  // A write error surfaces as an 'error' event; remember it so the loop stops.
  let streamError: unknown;
  if (out) {
    try {
      // Opened up front, so an unwritable path fails before any request.
      sink = (await open(out, "w")).createWriteStream();
    } catch (error) {
      failJson({ message: `Could not write ${out}: ${(error as Error).message}` });
      return;
    }
  } else {
    sink = process.stdout;
  }
  const onError = (error: unknown) => {
    streamError = error;
  };
  sink.on("error", onError);

  const abort = async () => {
    if (!out) return;
    sink.destroy();
    await rm(out, { force: true });
  };

  // One JSONL line. A sink that already failed (e.g. ENOSPC while the next page
  // was in flight) or was destroyed is reported, never written to; a full buffer
  // waits for 'drain', so a slow consumer (a pipe, a disk) never makes the CLI
  // buffer the whole export.
  const writeLine = async (value: unknown) => {
    if (streamError) throw streamError;
    if (sink.destroyed || sink.writableEnded) {
      throw Object.assign(new Error("the output was closed"), { code: "EPIPE" });
    }
    if (!sink.write(`${JSON.stringify(value)}\n`)) await drained(sink);
  };

  let conversations = 0;
  let messages = 0;
  let after: string | null = null;
  let headerWritten = false;
  try {
    do {
      const params = new URLSearchParams({ limit: String(PAGE_SIZE) });
      if (after) params.set("after", after);
      const result = await performApiRequest({
        server: options.server,
        path: `/api/codes/${encodeURIComponent(code)}/conversations?${params}`,
      });
      if (!result.ok) {
        // performApiRequest already printed the server's { message } on stderr.
        await abort();
        return;
      }
      const page = result.payload;
      // A cursor that does not move would loop forever over the same page.
      if (!isPage(page) || (after !== null && page.nextCursor === after)) {
        failJson({ message: "Unexpected response from the server's conversation export." });
        await abort();
        return;
      }
      if (!headerWritten) {
        await writeLine({
          type: "export",
          format: EXPORT_FORMAT,
          ...page.code,
          exportedAt: new Date().toISOString(),
        });
        headerWritten = true;
      }
      for (const conversation of page.conversations) {
        await writeLine({ type: "conversation", ...conversation });
        conversations += 1;
        messages += conversation.messages.length;
      }
      if (streamError) throw streamError;
      after = page.nextCursor;
    } while (after !== null);

    if (out) {
      sink.end();
      await finished(sink);
      if (streamError) throw streamError;
      printJson({ code, file: out, conversations, messages });
    }
  } catch (error) {
    if (!out && isBrokenPipe(error)) return;
    failJson({
      message: `Could not write ${out ?? "the export"}: ${(error as Error).message}`,
    });
    await abort();
  }
  // The error listener stays attached: a late EPIPE on stdout must not crash.
}
