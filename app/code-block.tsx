"use client";

import type { ComponentProps } from "react";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneLight } from "react-syntax-highlighter/dist/esm/styles/prism";
import { useCopyToClipboard } from "@/components/use-copy-to-clipboard";
import styles from "./code-block.module.css";

// Renders a fenced code block: a header (language label + copy button) above a
// syntax-highlighted body with soft-wrapped long lines, plus line numbers for
// multi-line snippets. Inline code (no language fence) falls through to a plain
// <code>.
//
// The theme is hard-coded to the light Prism theme (oneLight) and the surrounding
// chrome uses fixed light colors — it intentionally does NOT follow the system
// color scheme.
export function CodeBlock({
  className,
  children,
  // `node` is react-markdown's hast node; drop it so it doesn't leak onto the DOM.
  node: _node,
  ...rest
}: ComponentProps<"code"> & { node?: unknown }) {
  const match = /language-(\w+)/.exec(className ?? "");
  const text = String(children).replace(/\n$/, "");

  // No language class → inline code (or a fence without a language). Render plainly.
  if (!match) {
    return (
      <code className={className} {...rest}>
        {children}
      </code>
    );
  }

  const language = match[1];
  const multiline = text.includes("\n");

  return (
    <div className={styles.block}>
      <div className={styles.header}>
        <span className={styles.lang}>{language}</span>
        <CopyButton text={text} />
      </div>
      <SyntaxHighlighter
        language={language}
        style={oneLight}
        showLineNumbers={multiline}
        wrapLongLines
        PreTag="div"
        // Let the wrapping .block own the background, border, and rounding.
        customStyle={{
          margin: 0,
          background: "transparent",
          padding: "0.75rem",
          fontSize: "0.85rem",
        }}
        lineNumberStyle={{ color: "#afb8c1", minWidth: "2.2em" }}
      >
        {text}
      </SyntaxHighlighter>
    </div>
  );
}

function CopyButton({ text }: { text: string }) {
  // Clipboard may be unavailable (e.g. an insecure context) — copy() ignores it.
  const { copied, copy } = useCopyToClipboard({ resetMs: 1500 });

  return (
    <button
      type="button"
      className={`${styles.copy} ${copied ? styles.copied : ""}`}
      onClick={() => copy(text)}
      aria-label="Copy code to clipboard"
    >
      {copied ? "Copied" : "Copy"}
    </button>
  );
}
