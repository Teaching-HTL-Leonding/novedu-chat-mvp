# Usage dashboard

The teacher-only read surface over the usage metering tables at `/usage`. It is the
first UI on top of `novedu_usage_by_code` (docs/usage-metering.md, which otherwise
has no read surface) and the seed of a subsystem that grows: the token-over-time bar
chart is built to be reused on future single-code stats pages.

Read before touching: `app/usage/**`, `lib/usage-stats-store.ts`, `lib/usage-range.ts`,
the `--chart-*` tokens in `app/globals.css`, and the `/usage` entry in
`components/nav-menu.tsx`.

## What it shows

- A **stacked bar chart** of token usage over time — cached input, new input, output
  — with a **data table** of the same buckets beneath it.
- Two **donut pies**: total tokens per **module** (tutor/quiz/writing/coding) and per
  **code** (top 9 + "Other").
- Two **KPIs**: **Chats** (distinct Mastra threads with a user message) and **Quiz
  answers graded** (`SUM(quiz_answers)`).

A single **time filter** — `Last 24 hours / 7 days / 30 days / 365 days` — governs
**every** panel, including the KPIs.

## Time model — UTC

Everything is **UTC**: the `hour` column of `novedu_usage_by_code` is a top-of-hour
UTC bucket, and the dashboard labels and bucket boundaries are UTC too (axes say so).
There is no per-viewer timezone conversion, so a bucket boundary and its label always
line up. `lib/usage-range.ts` is the pure, deterministic core (it takes `now` as an
argument — no `new Date()` inside — so it is trivially unit-testable):

| range | grain | buckets |
|---|---|---|
| 24h | hour | 24 |
| 7d | day | 7 |
| 30d | day | 30 |
| 365d | month | 12 |

`resolveRange(range, now)` returns the window `start`, the `grain`, and the full
ordered bucket list (each with a UTC label); `zeroFill` merges the aggregate rows
onto that list so an empty hour/day/month renders as an explicit zero, not a gap;
`foldTopN` keeps the top-N slices and sums the rest into "Other". It imports nothing
server-only, so the client may use it too.

## The read seam — `lib/usage-stats-store.ts`

Mirrors `lib/code-stats-store.ts`: raw by-value `sql` via `getDb().execute` (the KPI
query joins Mastra's `mastra_messages`, which Drizzle never declares), and the
**never-throws** contract — every function returns `undefined` on a DB error and
logs it, so a failed panel degrades to "unavailable" instead of crashing the page.
**One query per chart/KPI**, each aggregating in SQL so only a small result set
crosses the wire, and **read once where the shape allows**:

- `getTokenTimeSeries({ range, now, code? })` — SUM per UTC bucket, `WHERE hour >=
  start [AND code = @code]`, zero-filled. Feeds the **bar chart AND the table**.
  `code?` is the **reuse seam** for single-code stats pages; omitted, it sums across
  all codes.
- `getUsageBreakdown({ range, now })` — one `(code, module)` scan feeds **both pies**
  (summed by module, folded top-9-by-code + Other). Code slices are labelled with the
  teacher's own **note**, never a student.
- `getDashboardKpis({ range, now })` — one round trip, two windowed subselects, feeds
  **both KPI tiles**.

## Loading model — server components + Suspense streaming

The dashboard is **server-first**, matching the repo's stats convention
(`conversation-stats.tsx` → `getCodeStats`): each section is an async **server**
component that reads the store directly and passes data as **props** to thin client
chart children — there is deliberately **no client `fetch('/api/*')`** and so **no
`/api/usage/*` route to gate** (the page's `isEffectiveTeacher()` is the whole gate).

"Load immediately with loading indicators" is React `<Suspense>` streaming: the page
shell + range tabs flush instantly and each section streams in independently behind
its own skeleton (`app/usage/chart-skeleton.tsx`). The time filter is the `?range=`
search param — `range-tabs.tsx` is a small client `<Link>` group; the Suspense
boundaries are **keyed by range**, so switching shows the skeletons again while the
new window streams. `page.tsx` snaps one `now` and passes it to every section, so the
KPI, chart, and pies all describe the same window.

## Charts & palette

Recharts (`recharts`, a client-only lib — every chart is a `"use client"` child fed
by props). It renders via inline SVG styles and ships **no global stylesheet to
import**, so it adds no unlayered CSS and does not touch the `@layer` order
(docs/styling.md). Research current Recharts docs via context7 (`/recharts/recharts`)
before charting work.

Colors follow docs/styling.md — the dataviz-validated hues live **only** as
`--chart-*` tokens in `app/globals.css` (shadcn's `--chart-1..N` convention, so
shadcn's chart components drop in later); components carry **no bare hex**. Because an
SVG `fill` attribute does not resolve a CSS custom property, `_charts/chart-colors.ts`
reads the tokens with `getComputedStyle` and hands Recharts concrete strings; chart
**chrome** (grid/axis/legend/tooltip) uses `currentColor` + opacity or token-based
HTML styles off the `foreground` ramp. The bar chart's companion table and the pies'
legends are the dataviz **"relief"** that keeps the two sub-3:1 hues legible. The app
is **light-only**. The code pie is top-9 + "Other"; only the first 8 hues are
CVD-validated and a 10-slice pie is at the readability limit, so `N` is a single
constant (`foldTopN`) if a ranked bar or top-8 is later preferred.

## Anonymity

Unchanged from docs/usage-metering.md: `novedu_usage_by_code` carries **no user id**,
so nothing the dashboard reads can link a student to an activity. The per-code pie
labels slices with the teacher's note; the "Chats" KPI counts threads, never
students. No message/prompt content or PII is read.

## Testing

- **Unit** — `lib/usage-range.unit.test.ts` (pure windowing/labels/zero-fill/foldTopN
  with an injected `now`); `lib/usage-stats-store.unit.test.ts` (the
  `code-stats-store.unit.test.ts` template — mock `getDb().execute` with a canned
  recordset, assert the shaping + never-throws); `app/usage/page.unit.test.tsx` (the
  teacher gate) and the section server components via `renderToStaticMarkup`.
- **Component** — the bar + pie charts render props-driven in the `vitest-browser`
  project (real Chromium).
- **E2E** — `e2e/usage-dashboard.live.spec.ts` (`@live-db`, seeds
  `novedu_usage_by_code` via the raw `mssql` driver, runs in CI) and a hermetic
  access-denied spec (default student session). See docs/testing.md.

## Extending it

- **A new chart/KPI**: add a store function (one query), a client chart child fed by
  props, and a section behind its own `<Suspense>`.
- **Single-code stats page**: call `getTokenTimeSeries({ code })` from a server
  component and render `<TokenUsageBarChart>` with the result — the seam already
  exists.
- **Exact-local windows** (if the user base ever leaves CET): the only change is
  anchoring the window/labels to a viewer timezone; the store filter stays `hour >=
  start`.
