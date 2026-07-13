import type { Link, Parent, PhrasingContent, Root, RootContent, Text } from "mdast";
import type { VFile } from "vfile";
import { type GlossaryEntry, loadGlossary, normalizeTermKey } from "./glossary.ts";
import { withBase } from "./paths.ts";

/** `[[term]]` or `[[term|shown text]]`. */
const MARKER = /\[\[([^\]|]+?)(?:\|([^\]]+?))?\]\]/g;

export interface RemarkGlossaryTermsOptions {
  /** The site's deploy base (Astro `base`); defaults to "/". */
  base?: string;
  /** Injectable for hermetic tests; defaults to the shared corpus glossary. */
  loadLookup?: () => Map<string, GlossaryEntry>;
}

/**
 * Turns `[[term]]` / `[[term|shown]]` markers in body text into links to
 * `<base>/glossary#<slug>`. Text is walked with link-ancestry tracking, so a
 * marker anywhere inside a link (even nested in emphasis) renders as plain
 * text instead of producing an invalid nested anchor. Code blocks and inline
 * code are distinct node types and stay untouched. Unknown terms log a build
 * warning and render as plain text — never a broken link.
 */
export function remarkGlossaryTerms(options: RemarkGlossaryTermsOptions = {}) {
  const base = options.base ?? "/";
  const load = options.loadLookup ?? (() => loadGlossary().lookup);
  return (tree: Root, file?: VFile) => {
    const lookup = load();
    const where = () => file?.path ?? file?.history?.[0] ?? "unknown file";

    function transformText(node: Text, inLink: boolean): (Text | Link)[] | null {
      const parts: (Text | Link)[] = [];
      let last = 0;
      for (const match of node.value.matchAll(MARKER)) {
        const [full, rawTerm = "", shown] = match;
        const start = match.index ?? 0;
        const display = shown ?? rawTerm;
        if (start > last) {
          parts.push({ type: "text", value: node.value.slice(last, start) });
        }
        const entry = lookup.get(normalizeTermKey(rawTerm));
        if (!entry) {
          console.warn(
            `[teacher-docs-site] unknown glossary term "[[${rawTerm}]]" in ${where()} — rendered as plain text`,
          );
          parts.push({ type: "text", value: display });
        } else if (inLink) {
          console.warn(
            `[teacher-docs-site] glossary marker "[[${rawTerm}]]" sits inside a link in ${where()} — rendered as plain text (links cannot nest)`,
          );
          parts.push({ type: "text", value: display });
        } else {
          parts.push({
            type: "link",
            url: withBase(base, `glossary#${entry.slug}`),
            // Zero-CSS hook for the deferred glossary-tooltip follow-up.
            data: { hProperties: { "data-glossary-term": entry.slug } },
            children: [{ type: "text", value: display }],
          });
        }
        last = start + full.length;
      }
      if (parts.length === 0) return null;
      if (last < node.value.length) {
        parts.push({ type: "text", value: node.value.slice(last) });
      }
      return parts;
    }

    function walk(parent: Parent, inLink: boolean): void {
      for (let i = 0; i < parent.children.length; i++) {
        const child = parent.children[i] as RootContent;
        if (child.type === "text") {
          if (!child.value.includes("[[")) continue;
          const parts = transformText(child, inLink);
          if (parts) {
            parent.children.splice(i, 1, ...(parts as PhrasingContent[]));
            i += parts.length - 1;
          }
          continue;
        }
        if ("children" in child) {
          walk(child, inLink || child.type === "link" || child.type === "linkReference");
        }
      }
    }

    walk(tree, false);
  };
}
