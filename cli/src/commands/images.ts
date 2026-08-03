import { readFile } from "node:fs/promises";
import type { Command } from "commander";
import { imageMimeFromExtension } from "@/lib/file-name";
import { failJson, performApiRequest, runApiRequest } from "../api";

// App-hosted image management over the bearer API (docs/api.md). Upload is
// CREATE-ONLY (a taken name is a 409 — delete + re-upload in the web app to
// replace an image) and runs the same confirm-only, direct-to-blob flow as the
// web form: request an upload slot, PUT the raw bytes straight to Blob Storage
// (never through the app), confirm. List mirrors the /images page's filters.
// JSON in/out — see cli/src/api.ts for the output contract: exactly one JSON
// object on exactly one stream per invocation, whichever step fails.

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

      // MIME from the file extension — the one client-side check, because the
      // server pins the SAS (and the blob's stored content type) to this value.
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

      // Step 1: request an upload slot (validates name/MIME/size, mints the
      // create-only SAS, writes no DB row).
      const slot = await performApiRequest({
        server: options.server,
        path: `/api/images/${encodeURIComponent(name)}`,
        method: "POST",
        body: { mime, byteSize: bytes.length },
      });
      if (!slot.ok) return;
      const { uploadUrl, blobPath } = (slot.payload ?? {}) as Record<string, unknown>;
      if (typeof uploadUrl !== "string" || typeof blobPath !== "string") {
        failJson({ message: "Unexpected response from the server." });
        return;
      }

      // Step 2: PUT the raw bytes straight to Blob Storage. The SAS is the
      // auth (no bearer header); the content type must equal the requested
      // MIME — the SAS pins it.
      let putResponse: Response;
      try {
        putResponse = await fetch(uploadUrl, {
          method: "PUT",
          headers: { "x-ms-blob-type": "BlockBlob", "content-type": mime },
          body: new Uint8Array(bytes),
        });
      } catch (error) {
        failJson({
          message: `Could not reach storage: ${error instanceof Error ? error.message : error}`,
        });
        return;
      }
      if (!putResponse.ok) {
        failJson({
          message: `The upload to storage failed: HTTP ${putResponse.status}. Try again.`,
        });
        return;
      }

      // Step 3: confirm — the server inspects the landed blob and writes the
      // row; its response (or error) is the command's output.
      await runApiRequest({
        server: options.server,
        path: `/api/images/${encodeURIComponent(name)}/confirm`,
        method: "POST",
        body: {
          blobPath,
          mime,
          ...(options.credit === undefined ? {} : { credit: options.credit }),
        },
      });
    });

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
