# Styling

Tailwind CSS v4 is the app's styling system. This doc is the contract for any `className` work: tokens, the reuse boundary, layer discipline, and the seams third-party CSS (CopilotKit, KaTeX, CodeMirror) plugs into.

Research current Tailwind docs in context7 (`ctx7` CLI) before styling work — v4 is CSS-first and its idioms (`@theme`, `@plugin`, `@utility`, opacity modifiers) differ from most training data.

## Stack

- **Tailwind v4, CSS-first.** There is no `tailwind.config.js`. The entire configuration lives in `app/globals.css`: a leading `@layer` order statement, `@import "tailwindcss"`, `@plugin "@tailwindcss/typography"`, the token block, and a handful of `@layer base` rules. The build hook is `postcss.config.mjs` (`@tailwindcss/postcss`), picked up by Turbopack for `dev`, `build`, and the Vitest browser project alike.
- Sources are **allowlisted**: `@import "tailwindcss" source(none)` plus explicit `@source` lines for `app/`, `components/`, and `lib/`. Only code that renders markup generates utilities — docs, teaching YAML (`activities/`), and tests are never scanned, so a class-shaped string there can't generate (or break) CSS, and test-only classes can't ship in the production stylesheet.
- `class-variance-authority` (variants), `clsx` + `tailwind-merge` (via `cn()`) are the only styling runtime deps.

## Tokens

Plain values live on `:root`, mapped onto Tailwind tokens via `@theme inline` — both in `app/globals.css`. Names follow **shadcn/ui** (`background`, `foreground`, `primary`, `muted`, `border`, `ring`, `radius`, …) so shadcn components drop in later unchanged; `success` / `warning` / `destructive` are the status colors (green-700 / amber-700 / red-700).

- **Light-only by design**: `color-scheme: light` is forced; the theme is intentionally independent of the system scheme. Do not add dark-mode variants.
- Fonts: Geist via `next/font` variables (`--font-geist-sans`/`--font-geist-mono` on `<html>`), wired to `--font-sans`/`--font-mono` in `@theme inline`. Preflight applies them; components never name fonts directly (`font-mono` where needed).
- **Derived tints use the opacity ramp on `foreground`**, not new hex values:

  | Utility | Role |
  |---|---|
  | `foreground/5` | hover wash |
  | `foreground/10` | badge/chip background |
  | `foreground/15` | hairline borders, dividers |
  | `foreground/25` | control borders (inputs, buttons) |
  | `foreground/55`–`/70` | muted/secondary text |

  Anything outside the ramp snaps to a token or a stock palette color (`red-700`, `blue-600`, …). Never introduce a bare hex in a component.

## Reuse boundary

The core rule: **formatting for a repeated construct is written once.**

- Reusable primitives live in `components/ui/` as cva components (`Button`, `IconButton`, `Input`, `Badge`, `Field`/`FieldLabel`/`FieldError`/`FieldSuccess`, …). A primitive owns its full recipe; variants (`variant`, `size`) are cva options, not copy-pasted class strings.
- A recipe with **behavior** is a component, not a class string: `DialogShell` (`components/ui/dialog-shell.tsx`) owns every modal's open/close/Escape/backdrop contract and its flex-column shell; `PageBody` (`components/page-main.tsx`) owns the page gutter + scroll rhythm. Pure-look recipes shared across a couple of surfaces ship as exported class constants composed via `cn()` deltas (`DIALOG_BODY`, `META_LABEL`, `MENU_PANEL`/`MENU_ITEM`, the `CENTERED_CARD*` trio on `Notice`).
- **≥2 uses ⇒ promote.** If the same visual recipe appears in two places, it becomes a primitive, a cva variant, or a prop of the owning shared component (`DataList` owns table chrome, `ModuleChat` owns the chat container, `MarkdownRenderer` owns prose). Duplicated class soup across pages is a review-blocker.
- One-off chrome (the nav bar, the health grid, a page's unique layout) is styled inline with utilities in its single component — no indirection for things that exist once.
- `@apply` is not used; reuse happens in components, not CSS.

### The `cn()` contract

`cn()` (`lib/utils.ts`) = `twMerge(clsx(...))`. Every component with a `className` prop merges it via `cn(base, className)`, so callers pass **deltas** (e.g. `className="h-full"`) and win on conflict. Components that style `<Link>`/`<a>` like a button consume the exported `buttonVariants` instead of duplicating the recipe.

## Layer discipline

`app/globals.css` opens with `@layer theme, base, mantine, components, utilities;`.

- **All app CSS lives inside these layers.** An unlayered rule beats every layered one and silently overrides utilities — including CopilotKit's: its precompiled stylesheet (`@copilotkit/react-core/v2/styles.css`, Tailwind v4 with `cpk:`-prefixed utilities) merges into the same-named layers. The single sanctioned unlayered rule is the `.copilotKitChat` scrollbar-gutter fix, documented inline in `globals.css`.
- The `mantine` layer is reserved (empty): adding Mantine later is importing its `styles.layer.css`, which slots between `base` and `components` without reshuffling.
- shadcn/ui needs no layer work — its components are utility-based and the token names already match.
- The CopilotKit stylesheet imports stay at the chat component entry points (`app/module-chat.tsx`, the transcript `ConversationView`) — never hoisted to the root layout.
- If a custom `@utility` is ever added, `cn()` needs `extendTailwindMerge` so tailwind-merge understands it; plain token-based utilities need nothing.

## Markdown and third-party surfaces

- **Markdown always renders through `MarkdownRenderer`** (`app/markdown-renderer.tsx`), which wraps output in typography's `prose` (preflight strips UA heading/list defaults; prose restores real ones). Prose colors are re-mapped to `foreground` in `globals.css`; inline-code backticks are suppressed; `CodeBlock` opts out via `not-prose` and owns its chrome (the `react-syntax-highlighter` `oneLight` theme object).
- KaTeX ships its own unlayered CSS, imported in `app/layout.tsx` before `globals.css`; it beats layered rules by design. Never restyle `.katex*` internals.
- CodeMirror is styled from the outside: wrapper utilities plus arbitrary-variant reaches like `[&_.cm-editor]:h-full`. `.cm-*` class internals are e2e-test hooks — leave them alone.

## Breakpoints and dynamic values

- Tailwind defaults only; mobile-first (`md:`), exact complements via `max-md:`.
- **`md` (48rem) is shared state with JS**: the writing surface's `SIDE_BY_SIDE_QUERY` matchMedia uses the same 48rem — change one, change both (see `docs/writing.md`).
- Runtime-computed values flow through CSS variables set in a `style` prop and consumed by static arbitrary-value utilities (e.g. the writing split panes: `style={{ "--editor-grow": … }}` + `flex-[var(--editor-grow,1)_1_0]`). Class strings stay static so the scanner sees them (markdown is excluded from scanning — see Stack).
- Values snap to Tailwind's default scale; an arbitrary value is acceptable only where a real constraint demands it, with a comment saying which.

## Lint and formatting

- Biome sorts utility classes (`nursery.useSortedClasses`, applied by `npm run check:fix`) in `class`/`className` attributes and inside `cn`/`cva`/`clsx` calls.
- `biome.json` enables `css.parser.tailwindDirectives` (Biome parses `@theme`/`@plugin`) and `css.parser.cssModules`.
- Accessibility helper: use the built-in `sr-only`.
