import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import type { Command } from "commander";
import { imageMimeFromExtension } from "@/lib/file-name";
import { failJson, runApiRequest } from "../api";

// App-hosted image management over the bearer API (docs/api.md). Upload is
// CREATE-ONLY (a taken name is a 409 — delete + re-upload in the web app to
// replace an image) and is ONE multipart POST: the bytes, declared MIME
// and optional credit travel to the app in a single request — no upload slot,
// no direct-to-storage PUT, no confirm step. List mirrors the /images page's
// filters. JSON in/out — see cli/src/api.ts for the output contract: exactly
// one JSON object on exactly one stream per invocation.

const SERVER_OPTION = [
  "--server <url>",
  "Novedu server base URL (defaults to the NOVEDU_SERVER env var, then production)",
] as const;

interface UploadOptions {
  server?: string;
  file?: string;
  credit?: string;
}

interface ListOptions {
  server?: string;
  search?: string;
  all?: boolean;
}

export function registerImages(program: Command): void {
  const images = program
    .command("images")
    .description("Manage app-hosted images on the Novedu server");

  images
    .command("upload <name>")
    .description("Upload a NEW image (.png, .jpg/.jpeg or .svg, max 5 MB) from --file")
    .option("--file <path>", "the image file to upload (required — images are binary, no stdin)")
    .option("--credit <text>", "optional attribution shown with the image (max 512 chars)")
    .option(...SERVER_OPTION)
    .action(async (name: string, options: UploadOptions) => {
      if (options.file === undefined) {
        failJson({ message: "Pass --file <path> — images are binary, stdin is not supported." });
        return;
      }

      // MIME from the file extension — the one client-side check; the server
      // stores this value verbatim as the row's `mimeType` and returns it on
      // every read, so what is declared here is what a viewer's browser sees.
      const mime = imageMimeFromExtension(options.file);
      if (mime === null) {
        failJson({ message: "Only .png, .jpg/.jpeg and .svg files can be uploaded." });
        return;
      }

      let bytes: Buffer;
      try {
        bytes = await readFile(options.file);
      } catch (error) {
        failJson({
          message: `Could not read ${options.file}: ${error instanceof Error ? error.message : error}`,
        });
        return;
      }

      // One multipart POST: the bytes (as a `file` part with a filename), the
      // declared `mime` and an optional `credit` — no `content-type` header
      // here, `fetch` sets its own multipart boundary from the `FormData`.
      const form = new FormData();
      form.set("file", new File([new Uint8Array(bytes)], basename(options.file), { type: mime }));
      form.set("mime", mime);
      if (options.credit !== undefined) form.set("credit", options.credit);

      await runApiRequest({
        server: options.server,
        path: `/api/images/${encodeURIComponent(name)}`,
        method: "POST",
        body: form,
      });
    });

  // Each row carries `id` and an absolute `url` — the url only resolves bytes
  // for a signed-in browser session, so share the image's *name* (see
  // `upload`), not this url.
  images
    .command("list")
    .description("List app-hosted images (defaults to only your own, like the web list)")
    .option("--search <q>", "contains-filter over the name")
    .option("--all", "include images uploaded by other teachers")
    .option(...SERVER_OPTION)
    .action(async (options: ListOptions) => {
      const params = new URLSearchParams();
      if (options.search) params.set("q", options.search);
      if (options.all) params.set("mine", "0");
      const query = params.toString();
      await runApiRequest({
        server: options.server,
        path: `/api/images${query ? `?${query}` : ""}`,
      });
    });
}
