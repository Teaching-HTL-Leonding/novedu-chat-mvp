# Testing strategy

Deep reference for how this repo is tested. The always-on rule is summarized in
`AGENTS.md`; this file has the full picture. Read it before adding a test,
tagging one `@live`, or changing the CI test jobs.

## Principle

Prefer fast, deterministic, **secret-free** unit/component tests that run in CI.
Reserve full-stack e2e for what genuinely needs the real wired-together app. A
test earns an `@live` tag **only** if its assertion truly needs the live
database or the SCCH LLM — not merely because the code path happens to sit
behind one. If the logic short-circuits before the runtime is built (the chat
gate) or is pure-prop rendering, it belongs in a fast test.

Two kinds of e2e:

- **Hermetic e2e** — no external infra (the auth gate, routing, teacher/student
  permissions, client-side validation). These **run in CI**.
- **`@live` e2e** — need real Azure SQL and/or the SCCH LLM. **Excluded from
  CI**; run locally as a pre-push regression smoke.

The boundary is a single **`@live`** tag. CI excludes it via
`npm run test:e2e:ci` (`--grep-invert @live`). Live credentials must never run
on a fork `pull_request` — see `docs/ci-security.md`.

## Layers & tools

| Layer | Tool (vitest project) | File glob | Env | In CI |
| --- | --- | --- | --- | --- |
| Unit | Vitest `unit` | `**/*.unit.test.{ts,tsx}` | jsdom (or `node` per-file) | ✅ |
| Component | Vitest `component` | `**/*.browser.test.tsx` | Playwright Chromium (real browser) | ✅ |
| Hermetic e2e | Playwright | `e2e/*.spec.ts` (untagged) | dev server, no infra | ✅ |
| `@live` e2e | Playwright | `e2e/*.spec.ts` tagged `@live` | real DB + LLM | ❌ local only |

- Config: **`vitest.config.mts`** defines the `unit` + `component` projects;
  **`playwright.config.ts`** the e2e suite (with `e2e/auth.setup.ts` minting
  session cookies — see `docs/auth.md`).
- A unit test that needs Web `fetch` types or to import a server route uses the
  per-file pragma `// @vitest-environment node` (still in the `unit` project).

## Scripts

| Script | Runs |
| --- | --- |
| `npm run test` | Vitest `unit` + `component` (`test:unit` / `test:component` for one) |
| `npm run test:e2e` | Playwright, all specs (needs `az login` + `.env` for `@live`) |
| `npm run test:e2e:ci` | Playwright minus `@live` — the hermetic suite CI runs |
| `npm run qa` | `check` + `typecheck` + `test` + `build` (`qa:e2e` adds e2e) |

Run the local-only smoke (with `az login` done and `.env` populated):

```
npm run test:e2e -- --grep @live
```

The kept `@live` set is deliberately small: a valid code opens the chat, a
mid-session window-close keeps the chat on screen, the text round-trip, the
vision round-trip, the health probe, a teacher creating a code, and the YAML
Files create → list → update → soft-delete lifecycle (`e2e/files.spec.ts`, which
writes the real `novedu_files` table).

## Testing the chat gate and server components WITHOUT infra

The chat runtime route and the chat page consume security-critical inputs but
their decisions are fast to test — the gate returns 401/403/404 before any
runtime is built, and the page maps a check result to a view. The pattern (see
`app/api/copilotkit/[[...slug]]/route.unit.test.ts` and
`app/[code]/page.unit.test.tsx`):

1. `// @vitest-environment node`.
2. `vi.mock` the I/O seams — `@/auth`, the `novedu_*` stores, `@/app/mastra`,
   and (past the gate) the CopilotKit runtime / Mastra agent factory.
3. Keep the **security-critical pure module REAL** — e.g. `lib/thread-token.ts`
   (the HMAC), so the test exercises the actual check, not a stub of it.
4. Drive real `Request` objects through the exported handler, or call the
   `async` server component directly and render its element with
   `renderToStaticMarkup`; assert status / JSON / HTML.

This is how the thread-ownership, window-enforcement, and rejection-rendering
behaviors — formerly only reachable via `@live` e2e — now run in CI.

## CI

`.github/workflows/qa.yml` runs `check` → `typecheck` → `test:unit` →
`test:component` → `build`, plus a separate hermetic e2e job (`test:e2e:ci`).
Every job is **secret-free**; that is a hard security invariant, not a
convenience — see **`docs/ci-security.md`**.

## Subsystem specifics

- **Tutor codes / the chat gate** → `docs/tutor-codes.md` (Testing section).
- **Auth & e2e session cookies** → `docs/auth.md`.
