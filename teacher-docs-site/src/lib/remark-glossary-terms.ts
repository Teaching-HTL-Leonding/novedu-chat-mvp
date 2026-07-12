import type { Link, Parent, Root, Text } from "mdast";
import { SKIP, visit } from "unist-util-visit";
import type { VFile } from "vfile";
import { type GlossaryEntry, loadGlossary } from "./glossary.ts";

/** `[[term]]` or `[[term|shown text]]`. */
const MARKER = /\[\[([^\]|]+?)(?:\|([^\]]+?))?\]\]/g;

export interface RemarkGlossaryTermsOptions {
  /** Injectable for hermetic tests; defaults to the shared corpus glossary. */
  loadLookup?: () => Map<string, GlossaryEntry>;
}

/**
 * Turns `[[term]]` / `[[term|shown]]` markers in body text into links to
 * `/glossary#<slug>`. Only `text` nodes are visited, so fenced code and inline
 * code are untouched by construction. An unknown term logs a build warning and
 * renders as plain text — never a broken link.
 */
export function remarkGlossaryTerms(options: RemarkGlossaryTermsOptions = {}) {
  const load = options.loadLookup ?? (() => loadGlossary().lookup);
  return (tree: Root, file?: VFile) => {
    const lookup = load();
    visit(tree, "text", (node: Text, index, parent) => {
      if (!parent || index === undefined || parent.type === "link") return;
      if (!node.value.includes("[[")) return;

      const parts: (Text | Link)[] = [];
      let last = 0;
      for (const match of node.value.matchAll(MARKER)) {
        const [full, rawTerm = "", shown] = match;
        const start = match.index ?? 0;
        const display = shown ?? rawTerm;
        if (start > last) {
          parts.push({ type: "text", value: node.value.slice(last, start) });
        }
        const entry = lookup.get(rawTerm.trim().toLowerCase());
        if (entry) {
          parts.push({
            type: "link",
            url: `/glossary#${entry.slug}`,
            // Zero-CSS hook for the deferred glossary-tooltip follow-up.
            data: { hProperties: { "data-glossary-term": entry.slug } },
            children: [{ type: "text", value: display }],
          });
        } else {
          const where = file?.path ?? file?.history?.[0] ?? "unknown file";
          console.warn(
            `[teacher-docs-site] unknown glossary term "[[${rawTerm}]]" in ${where} — rendered as plain text`,
          );
          parts.push({ type: "text", value: display });
        }
        last = start + full.length;
      }
      if (parts.length === 0) return;
      if (last < node.value.length) {
        parts.push({ type: "text", value: node.value.slice(last) });
      }
      (parent as Parent).children.splice(index, 1, ...parts);
      return [SKIP, index + parts.length];
    });
  };
}
