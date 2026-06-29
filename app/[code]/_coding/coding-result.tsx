import type { CodeEntry } from "@/lib/code-store";
import { loadCoding } from "@/lib/coding-fetch";
import { CodingConnection } from "./coding-connection";

// The coding module's create/edit-screen result: the little-coder connection config
// (base URL, key, model, models.json, run command) INSTEAD of a share link — a coding
// code is an API key, not a web link. Reuses the shared `CodingConnection` (the same
// block on the student page + teacher detail), so the key + the real model stay
// server-side: only `title`, the code, and the generic model id reach the client.
// A server component called as a plain function from `codingModule.renderResult`.
export async function CodingResult({ entry, origin }: { entry: CodeEntry; origin: string }) {
  const loaded = await loadCoding(entry.fileUrl);
  const baseUrl = `${origin}/api/coding/v1`;
  const modelName = loaded.ok ? (loaded.coding.title ?? "Novedu coding") : "Novedu coding";

  return (
    <CodingConnection
      baseUrl={baseUrl}
      apiKey={entry.code}
      modelId="coding"
      modelName={modelName}
    />
  );
}
