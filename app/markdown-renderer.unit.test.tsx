import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MarkdownRenderer } from "./markdown-renderer";

// These tests pin the two things that MUST keep working: KaTeX math and
// syntax-highlighted code. They run in jsdom with no browser and no LLM — the
// renderer is a pure `content: string` → DOM component, so we feed it markdown
// directly. rehype-katex and react-syntax-highlighter both emit real DOM at
// render time, so every assertion below works headless.

describe("MarkdownRenderer — math", () => {
  it("renders inline $...$ as KaTeX exactly once", () => {
    const { container } = render(<MarkdownRenderer content={"Mass-energy: $E=mc^2$."} />);

    const katex = container.querySelectorAll(".katex");
    expect(katex).toHaveLength(1);
    // The class surviving at all is the regression guard: rehype-sanitize would
    // strip it (the original bug). A visual KaTeX subtree confirms it rendered.
    expect(container.querySelector(".katex-html")).not.toBeNull();
  });

  it("renders block $$...$$ (on its own lines) as display math", () => {
    // remark-math only treats $$ as *display* math when the fences sit on their
    // own lines; inline `$$x$$` stays inline. This is how models emit it.
    const { container } = render(
      <MarkdownRenderer
        content={"$$\n\\int_0^\\infty e^{-x^2}\\,dx = \\frac{\\sqrt{\\pi}}{2}\n$$"}
      />,
    );

    expect(container.querySelector(".katex-display")).not.toBeNull();
    // Fraction + integral structures only exist if KaTeX actually ran.
    expect(container.querySelector(".mfrac")).not.toBeNull();
  });

  it("does not render math markup for plain prose", () => {
    const { container } = render(<MarkdownRenderer content={"Just a sentence, no math."} />);
    expect(container.querySelector(".katex")).toBeNull();
  });
});

describe("MarkdownRenderer — code", () => {
  const PY = "```python\nx = 1\nprint(x)\nprint(x + 1)\n```";

  it("syntax-highlights a fenced block and labels the language", () => {
    const { container } = render(<MarkdownRenderer content={PY} />);

    // A language-tagged <code> with Prism token spans.
    const code = container.querySelector('code[class*="language-"]');
    expect(code).not.toBeNull();
    expect(container.querySelectorAll("code span[style]").length).toBeGreaterThan(0);

    // Header shows the language label.
    expect(screen.getByText("python")).toBeInTheDocument();
  });

  it("shows line numbers for multi-line snippets", () => {
    const { container } = render(<MarkdownRenderer content={PY} />);
    // Three code lines → three line-number markers.
    expect(container.querySelectorAll(".linenumber").length).toBe(3);
  });

  it("omits line numbers for a single-line snippet", () => {
    const { container } = render(<MarkdownRenderer content={"```js\nconst a = 1;\n```"} />);
    expect(container.querySelectorAll(".linenumber").length).toBe(0);
  });

  it("renders inline `code` as a plain <code> with no copy button", () => {
    const { container } = render(<MarkdownRenderer content={"Use `npm install` to start."} />);

    const code = container.querySelector("code");
    expect(code).not.toBeNull();
    expect(code?.className ?? "").not.toMatch(/language-/);
    expect(screen.queryByRole("button", { name: /copy code/i })).toBeNull();
  });

  it("does not wrap the block in a <pre> (avoids CopilotKit's dark frame)", () => {
    const { container } = render(<MarkdownRenderer content={PY} />);
    expect(container.querySelector("pre")).toBeNull();
  });

  it("does not leak react-markdown's `node` prop onto the DOM", () => {
    const { container } = render(<MarkdownRenderer content={PY} />);
    expect(container.querySelector("[node]")).toBeNull();
  });
});

describe("MarkdownRenderer — copy button", () => {
  const writeText = vi.fn().mockResolvedValue(undefined);

  beforeEach(() => {
    writeText.mockClear();
    // fireEvent (not userEvent) so this stub isn't shadowed by userEvent's own
    // clipboard stub.
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
  });

  it("copies the raw source (without the trailing newline) and flips to 'Copied'", async () => {
    render(<MarkdownRenderer content={"```ts\nconst answer = 42;\n```"} />);

    const button = screen.getByRole("button", { name: /copy code/i });
    expect(button).toHaveTextContent("Copy");

    fireEvent.click(button);

    expect(writeText).toHaveBeenCalledOnce();
    expect(writeText).toHaveBeenCalledWith("const answer = 42;");
    // The "Copied" label is set after the clipboard promise resolves.
    await screen.findByText("Copied");
  });
});
