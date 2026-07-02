# Mantine adoption — analysis & strategy (NOT implemented)

> **Status: ANALYSIS ONLY — nothing in this document has been built.**
> This is a feasibility/complexity study captured for future reference, written
> on 2026-06-18. No Mantine code, dependency, or config exists in the repo as a
> result of it. Treat every "do X" below as a *recommendation*, not a record of
> work done.
>
> The findings are deliberately kept at the level of **general structure**, not
> specific files or line counts, so they stay useful even though the surrounding
> code will keep changing before Mantine is ever introduced.

Subject: switching the app's UI to the [Mantine](https://mantine.dev) component
library, with particular attention to how it coexists with CopilotKit /
CopilotChat.

---

## Bottom line

Adopting Mantine is a **presentation-layer refactor, not a rebuild**. It is
**additive** — there is no competing component system to tear out — and it does
**not** touch the parts that are genuinely expensive to change: data layer
(Drizzle / Mastra), auth (`proxy.ts` / Auth.js), the AG-UI chat runtime, server
actions, validation, or business logic.

It can be **rolled out incrementally and shipped in stages.** That is the
recommended path, not a compromise.

---

## Why this is low-risk structurally

These properties are expected to hold regardless of code changes before adoption:

- **No competing component library** (no MUI / Chakra / Radix). The app styles
  with **Tailwind CSS v4 + small cva primitives** (`components/ui/`, see
  `docs/styling.md`); Mantine is added alongside — Tailwind utilities and
  `.mantine-*` components coexist, and the app's utility classes never target
  Mantine internals.
- **Modern Mantine (v7/v8) is static, scoped CSS** — `.mantine-*` classes, native
  CSS variables, PostCSS. It is **not** CSS-in-JS / Emotion anymore. Adding
  `MantineProvider` does **not** restyle existing CSS-Module components, so the
  two systems can coexist on the same page indefinitely.
- **The chat is a self-contained widget.** CopilotChat owns its own styling
  surface and is the *least* affected area (details below).

---

## CopilotKit / CopilotChat coexistence

This was the main open question and the answer is favorable.

- **Separate namespaces, no collision.** Mantine uses `--mantine-*` variables and
  `.mantine-*` classes; CopilotChat uses `--copilot-kit-*` / `[data-copilotkit]`
  tokens and `copilotKit*` classes. Theming the chat to *match* a Mantine palette
  is a small task — override a handful of CSS variables on the chat wrapper. **The
  chat internals are not rebuilt with Mantine.**
- **One real compatibility consideration: CSS `@layer` ordering — already
  settled.** The chat ships **compiled Tailwind v4 with `@layer` directives**,
  and so does the app itself. `app/globals.css` opens with
  `@layer theme, base, mantine, components, utilities;` — the `mantine` layer is
  reserved (empty) between the app's base and its component/utility layers, so
  adopting Mantine is importing `@mantine/core/styles.layer.css` and letting it
  slot in. The layer discipline (no unlayered app rules) is documented in
  `docs/styling.md`.

Net: budget an afternoon for layer ordering + token matching for the chat, not a
rewrite.

---

## Complexity options

| Option | Scope | Rough effort | Notes |
|---|---|---|---|
| **A — Shell only** | Mantine provider + app shell + nav/menu/buttons/alerts + one re-themed CopilotChat wrapper. Forms, lists, chat content left as-is. | ~1–2 days | Lowest risk. Two visual languages visible at once. |
| **B — Full app, chat re-themed (recommended)** | A + all forms, the shared filtered-list abstraction, validation UI, editor chrome → Mantine. Chat re-themed to match, internals untouched. | ~5–7 days | Consistent look; expensive subsystems untouched. |
| **C — Overhaul** | B + dark mode, `@mantine/form`, `@mantine/dates`, icon set swap, visual redesign. | ~8–12+ days | Mostly scope-driven, not risk-driven. |

Effort figures assume a developer familiar with both Mantine and the app domain.

---

## Recommended path: incremental, deploy-in-stages

Doing **A first, deploying, living with it for days, then introducing controls
over time** is fully viable and is the recommended approach. Each later swap is a
small, independently shippable, easily revertible PR with no data/logic risk.

### Foundation — do this *fully* in the first increment

The trap is not the incremental controls; it is leaving foundational work
half-done. Get these right **once**, up front, because every later increment
depends on them and retrofitting means revisiting already-migrated components:

1. **`@layer` ordering** — done: the reserved `mantine` layer in
   `app/globals.css` (see above); verify with the Increment 0 spike.
2. **Theme tokens** — map the app's `:root` tokens (shadcn-style names:
   `--background`, `--foreground`, `--destructive`, `--radius`, … in
   `app/globals.css`) into the Mantine theme *early*, so every control added
   later inherits the right look instead of rendering in default-Mantine styling
   and creating visual drift.

### Suggested increment order

1. **Increment 0:** provider + layer setup + theme mapping + app shell + one
   re-themed CopilotChat wrapper. Deploy.
2. **List infrastructure as ONE unit** — the app has a *shared* filtered-list
   abstraction, so migrating it once propagates to all list pages at once. Do not
   migrate list pages one-by-one.
3. **Forms, one at a time** — migrate at **whole-component boundaries**; avoid a
   single form that is half Mantine / half native, which is where intra-component
   style clashes appear.
4. **Date pickers** — `@mantine/dates` (`DatePickerInput`) is a drop-in
   replacement for native `datetime-local` when convenient; isolated, no rush.

---

## Things to watch

- **Visual-consistency tax during the in-between.** Two design languages coexist
  until migration completes. Theming Mantine to match the current look (foundation
  step 2) keeps the gap small. Keep the dual-system phase to **days/weeks, not
  months** — long-lived dual systems calcify into permanent inconsistency.
- **Test churn.** The repo's component (Vitest) and e2e (Playwright) tests select
  by roles / labels / test ids, so most survive markup changes; still expect
  localized selector fixes per increment. (There is also known CopilotKit
  test-selector fragility to expect.)
- **The `foreground/N` opacity ramp** (the app's derived-tint idiom, see
  `docs/styling.md`) does not map 1:1 to Mantine's 10-shade scale — expect a
  manual theme-token mapping pass from the `:root` tokens.
- **CodeMirror stays** — it is not a Mantine concern; just re-wrap its container.
- **Not affected (de-risks the whole effort):** Mastra, Drizzle, auth / `proxy.ts`,
  AG-UI route, server actions, validators.

---

## Suggested first concrete step (when adoption begins)

A throwaway **Increment 0 spike**: Mantine provider + `@layer` ordering + theme
mapping from current tokens + app shell + one themed CopilotChat wrapper. This
validates the layer-ordering assumption against the real chat before committing to
the full path.
