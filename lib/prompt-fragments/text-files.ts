// Line-range semantics for embedded text files — the SINGLE source of truth shared by
// BOTH the authoring/runtime consistency check (`consistency.ts`, which bounds-checks a
// placed `{{file "alias" from= to=}}` range) and the render resolver (`load.ts`, which
// slices the prefetched body). Keeping the two on one implementation is why an
// out-of-bounds range can never validate differently than it renders.
//
// Handlebars-free by design: a fetched text file is spliced VERBATIM and never compiled,
// so this module (unlike `host-template.ts`) is not one of the three legal `handlebars`
// importers — it does pure string slicing only.

/**
 * Split a body into logical lines for range slicing. `body.split("\n")` yields a
 * trailing empty element for a body that ends in a newline (`"a\n"` → `["a", ""]`); we
 * drop exactly ONE such trailing element so a conventional newline-terminated file
 * reports its real line count (`"a\n"` is one line, not two). An empty body is zero
 * lines. NB: this is ONLY for line-range math — a no-range `{{file}}` renders the body
 * byte-for-byte (see `load.ts`), trailing newline and all.
 */
function toLines(body: string): string[] {
  if (body === "") return [];
  const lines = body.split("\n");
  if (lines[lines.length - 1] === "") lines.pop();
  return lines;
}

/** The number of logical lines in `body` (a newline-terminated final line is not double-counted). */
export function countLines(body: string): number {
  return toLines(body).length;
}

/**
 * Slice `body` to the 1-based inclusive line range `[from, to]` and re-join with `"\n"`,
 * appending nothing. `from` alone means "line `from` to end of file"; `to` alone means
 * "line 1 to `to`". `to` beyond EOF CLAMPS to end-of-file (native `Array.slice`
 * behaviour) — the runtime's graceful-degradation contract when a source file was
 * shortened after validation. The `from` lower bound is enforced by the caller
 * (`checkPlacements` errors on `from` beyond EOF), because an empty splice would
 * silently drop material.
 */
export function sliceLines(body: string, from?: number, to?: number): string {
  const lines = toLines(body);
  const start = from !== undefined ? from - 1 : 0;
  const end = to !== undefined ? to : lines.length;
  return lines.slice(start, end).join("\n");
}
