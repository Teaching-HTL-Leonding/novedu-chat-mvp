# `_studio/` — the student GUI workspace

**This folder is yours.** Everything for the YAML-editing GUI lives here. The two
files outside it under `app/files/gui/` (`edit/[...name]/page.tsx` and
`view/page.tsx`) are **app-owned route shells** — don't edit them; they just gate
access, load the YAML, and render your components (`StudentFileEditor` /
`StudentFileViewer`) with plain props.

Start by reading the full brief:

➡️ **[`docs/yaml-gui-student-contribution.md`](../../../../docs/yaml-gui-student-contribution.md)**

Quick rules:

- The `_` prefix means this folder is **not a route** — add as many files as you like.
- Import **only** from `@/lib/yaml-files` (the YAML Files API), your own files in
  here, and npm packages. **Never** from `@/components/*`, `@/app/*`, or other
  `@/lib/*`.
- Everything you write is a **`"use client"`** component (or a test/helper for one).
  You do not write server code, touch the database, or handle auth.
- Tests live next to your code: `*.unit.test.tsx` / `*.browser.test.tsx` here, and
  end-to-end specs in `e2e/yaml-gui/`. They run with `npm test` like the rest of the app.
