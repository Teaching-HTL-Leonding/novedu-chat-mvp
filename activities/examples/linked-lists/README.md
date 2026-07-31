# Linked Lists — embedding a sample solution with `text_files` + `{{file}}`

A single **coding** activity that shows off one feature: pulling an **arbitrary
plain-text file** (here a TypeScript source file — the teacher's sample solution)
into an activity's server-only prompt **verbatim**, with `text_files:` +
an inline `{{file "…"}}` marker.

| File | Kind | What it demonstrates |
| --- | --- | --- |
| [`linked-list-buddy.yaml`](linked-list-buddy.yaml) | coding | `text_files:` declaration + `{{file "solution"}}` marker (whole file, no range) |

## The teaching unit

The class implements a **singly linked list** in TypeScript from scratch — a tiny
music playlist where each node holds a `Song` (`title` + `artist`) and the nodes
are threaded with `next` pointers. The exercise asks for the usual operations
(`find`, `insertAtBeginning`, `insertAfter`, `delete`, `size`, `isEmpty`,
`toArray`), checked by a separate test suite, so the exact method names and return
conventions matter. The reference implementation the activity embeds is
[`LinkedListWithTests/src/linkedList.ts`](https://github.com/rstropek/htl-2025-26-2nd/blob/main/40-classes/LinkedListWithTests/src/linkedList.ts).

## What `text_files` + `{{file}}` do here

`text_files:` mirrors `fragment_files:` — each entry is an `id` alias (no dots)
plus an `http(s)` (or relative) `url`. Where a `{{fragment "alias.id"}}` marker
pulls in a schema-validated fragment, a `{{file "alias"}}` marker splices a plain
text file **exactly as fetched**:

```yaml
text_files:
  - id: solution
    url: https://raw.githubusercontent.com/…/src/linkedList.ts

instructions: |
  ```typescript
  {{file "solution"}}
  ```
```

- The reference is a **bare quoted alias** — `{{file "solution"}}`, no dot: there
  is nothing to select inside a plain file the way `alias.id` selects a fragment.
- The body is spliced **verbatim and never compiled as a template**, so a literal
  `{{` (or the `{ title, artist }` object literals in this source) stays literal.
- Whole file by default; the only excerpt mechanism is a 1-based, inclusive line
  range — `{{file "solution" from=10 to=40}}` — and the same file may be placed
  more than once with different ranges. This example embeds the whole file.
- One alias namespace: a `text_files` `id` may not collide with a `fragment_files`
  `id`, so every marker resolves unambiguously.

The activity uses it to hand the coding agent the teacher's **sample solution** as
a private reference for the target shape, wrapped in explicit instructions to
guide students toward it **without ever pasting it back** — the solution stays
server-only and never reaches the student. The activity also still pulls in the
shared `teenager_safety` fragment from
[`../shared/general-fragments.yaml`](../shared/general-fragments.yaml), showing
`fragment_files` and `text_files` side by side.

The full mechanics live in the coding guide,
[`../../coding/README.md`](../../coding/README.md), and the tutor guide,
[`../../tutors/README.md`](../../tutors/README.md).

## Validate it

```bash
npx @novedu/cli validate ./activities/examples/linked-lists/linked-list-buddy.yaml --kind coding
```

> These files are content only — like the other examples they are authoring
> templates, deliberately excluded from the automated tests.
