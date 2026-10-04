# Start page, achievements engine, saved quiz results & Settings

The start page (`/`) is every signed-in user's home: the code field and Recently
used, then the user's own progress — XP and level, a weekly streak, a 26-week
calendar with badges pinned to their days, medals and retake reminders from saved
quiz results, the badges closest to being earned, and all badges by family.
Teachers see the same page, built from their own usage. The Settings page
(`/settings`) holds the per-user preferences.
Visual design: `DESIGN.md` and `.impeccable/surfaces/app-page-tsx.md`.

Everything about progress is **private to the user**: no teacher view, no
comparison, no leaderboard. The page says so ("Your progress here is only
visible to you.").

## Files

| File | Kind | Responsibility |
|---|---|---|
| `lib/achievements/time.ts` | pure | Vienna-local dates/hours from UTC instants, calendar arithmetic, ISO week keys |
| `lib/achievements/derive.ts` | pure | usage days → weekly streak, lifetime milestones, running totals, the heatmap |
| `lib/achievements/quiz.ts` | pure | saved results → exact scores, medals, best/last per quiz, refresh nudges, the Quiz-mastery dates |
| `lib/achievements/catalog.ts` | pure, **server-only** | the achievement definitions |
| `lib/achievements/xp.ts` | pure | XP total and level |
| `lib/achievements/evaluate.ts` | pure | catalog × facts × stored grants → earned / new / in progress; Almost there; the Badges view |
| `lib/student-facts-store.ts` | server, never throws | the student's fact groups; each foreign table is read through its owning store (`lib/coding-key-store.ts`, `lib/quiz-result-store.ts`, `lib/report-store.ts`) |
| `lib/achievement-store.ts` | server, never throws | read grants, insert grants, mark seen |
| `lib/quiz-result-store.ts` | server, never throws | save (with prune), list / count / delete own; `deleteResultsForCode` for the code-delete path — the only access to `novedu_quiz_results` |
| `lib/user-settings-store.ts` | server, never throws | read and upsert the user's settings row — the only access to `novedu_user_settings` |
| `lib/store-failure.ts` | server | fixed-message failure reporting for the stores above |
| `lib/home-cache.ts` | server | the per-user cache (TTL, single flight, generations, bound) |
| `lib/home-data.ts` | server | load → evaluate → insert new grants → the page's plain view model |
| `lib/achievement-actions.ts` | `"use server"` | `markAchievementsSeen` |
| `lib/quiz-actions.ts` → `saveQuizResult` | `"use server"` | the Finish page's save |
| `lib/user-settings-actions.ts` | `"use server"` | `updateUserSettings`, `deleteMyQuizResults` |
| `app/page.tsx`, `app/_home/**` | UI | the shell and its Suspense sections |
| `app/[code]/_quiz/save-result.tsx` | UI | the Finish page's consent and automatic save |
| `app/settings/**` | UI | the Settings page |

## Time rules

Usage buckets are UTC hours (`docs/usage-metering.md`); every day, week and hour
on the page is a **Vienna-local** cut of them (`HOME_TIME_ZONE`).

- **Active hour** — a `novedu_usage_by_user` bucket with
  `user_messages + quiz_answers + writing_saves + coding_requests > 0`; token-only
  buckets don't count. On the autumn clock change the two buckets sharing local
  02:00 are two hours; the missing spring hour has no bucket.
- **Coding hours of a day** — the distinct Vienna-local hours (0–23) with a coding
  request; the two autumn 02:00 buckets are one hour here.
- **Active day** — a local date with at least one active hour.
- **Week** — ISO week, keyed by the local date of its Monday (a week crossing New
  Year is one key).
- **Weekly streak (shown)** — consecutive active weeks ending at the current week,
  or at last week while the current week has no active day yet.
- **Longest streak (granted)** — the longest run in the whole history; streak
  badges come from it, so a break never takes one away.
- **Heatmap** — the current ISO week and the 25 before it; intensity 0 / 1 / 2–3 /
  4+ active hours; days after today are marked future.
- **Day distance** — the difference of local calendar dates, not elapsed hours;
  every "≥ n days" rule uses it.

## Quiz scores, medals and nudges

- **Score** — `(correct + 0.5 × partial) / total`; unanswered counts as wrong.
  Scores are compared as exact fractions (`2 × correct + partial` over
  `2 × total`, cross-multiplied in BigInt), never as rounded percentages. The page
  shows whole percent rounded **down**, so 100 % always means gold.
- **Medal** of a quiz, from its best saved attempt — gold = every slot correct,
  silver ≥ 80 %, bronze ≥ 50 %, else none. "Best" is the highest score, ties to the
  newest attempt (`finished_at`, then id) — the same row the store's prune keeps.
- **Refresh nudge** — a saved quiz whose last attempt is ≥ 5 days old AND (below
  gold OR > 14 days old) AND whose code exists with an open window. At most three,
  oldest last attempt first, ties by code; each shows last and best score and links
  to `/<code>`.

## Catalog and rules

An entry (`Achievement<F>` in `catalog.ts`) has a stable `id`, a family, an
order, an icon key, name, criterion, `hidden`, `xp`, the fact groups it `needs`,
and a pure `evaluate(facts)` that returns either `{ earned, qualifiedOn }` — the
local date on which the evidence was **first** complete — or
`{ current, target }`.

- Every rule is a **lifetime** predicate. A stored grant stays earned whatever the
  facts say later.
- Ids are generic catalog keys (`weekly-streak-4`), never containing a code, so
  `novedu_achievements` can never become a user↔code link. A tier ladder is
  `<ladder>-<n>`.
- The catalog is imported only by server modules. A guard test walks every
  `"use client"` module's value-import closure (stopping at `"use server"`
  modules) and fails if it reaches `catalog.ts`. Hidden entries reach the page
  data only once earned, so their names never ship to the browser before that.
- No achievement rewards a time of day or a chat-message count.

Families on the page:

- **Rhythm** — weekly streak 2/4/8/16, 3 and 5 active days in a week, 10/30/100
  active days.
- **Practice** — quiz answers 10/100/500, writing saves 5/25/100.
- **Quiz mastery** (from saved results) — First Result, Gold (every answer of a
  quiz correct) / Three Golds / Ten Golds (distinct quizzes, one ladder
  `quiz-golds-1/3/10`), Improved (an attempt beating the best of ALL earlier saved
  attempts of that quiz), Refreshed (two consecutive saved attempts of one quiz ≥ 5
  days apart). The rules read only the retained rows; "consecutive" is evaluated
  inside the newest-50 run, so the extra best row beyond it is never paired across
  the gap.
- **Coding** — Connected (a first coding key, dated to its issue day), First
  Request (the first day with a coding request), coding days 5/20, Toolbelt (keys
  for 3 coding activities).
- **Secret** (`hidden`) — Full Stack (chat, quiz, writing and coding inside one
  ISO week), In the Zone (coding in 3 different local hours of one day) and Bug
  Hunter (an own report was resolved, dated to the resolution day). The
  column shows only earned ones plus the note "Secret badges show up here once you
  earn them."; an unearned secret badge is never in Almost there, the Badges
  section, or any page data.

**Almost there** lists the next unearned tier of each ladder (a higher tier can't
be earned first) among listed entries with progress, closest to its target first,
catalog order breaking ties, at most four. The **Badges** section shows, per
family, the earned badges first, then the next tier of each ladder; "Show all
badges" reveals the rest.

**XP** = 10 × active days + Σ `xp` of the stored grants. Level `n` starts at
`50 · n · (n − 1)` XP. Computed on every load, never stored; monotonic because
neither active days nor grants are ever deleted.

## Evaluation flow

1. `lib/home-data.ts` loads the facts and the stored grants in parallel.
2. `evaluate` runs the catalog. A stored grant wins; a rule runs only when every
   group in its `needs` loaded — **a failed group is never read as zero**.
   Qualifying entries without a row are new grants.
3. New grants are inserted **before the load returns**
   (`INSERT … ON CONFLICT DO NOTHING RETURNING`; a concurrent tab's rows are
   re-read), so the page renders only durable state. If the insert fails, the
   grant-dependent sections are unavailable for that load.
4. A grant with `seen_at IS NULL` is new: the page shows a quiet strip with the
   count, marks those badges on the calendar and in the Badges section, and the
   client calls `markAchievementsSeen(ids)` once the strip has rendered. The action
   sets `seen_at` only on the **session user's** still-unseen rows of those ids.

## Facts

Each group is one statement keyed by the session user id and fails
independently.

- **Usage** (`loadStudentUsage`) — `novedu_usage_by_user` grouped by Vienna-local
  day over the whole history: active hours, the per-day counters (messages, quiz
  answers, writing saves, coding requests) and the coding hours. A range scan on
  the PK `(user_id, hour)`; the `@live-db` home spec checks the plan.
- **Keys** (`listOwnKeyDates`, `lib/coding-key-store.ts`) — the Vienna-local issue
  dates of the user's own coding keys, oldest first; nothing else leaves the
  store. A range scan on `ix_novedu_coding_keys_user_id`, plan-checked too.
- **Quiz** (`listOwnQuizResults`, `lib/quiz-result-store.ts`) — the user's saved
  results, each with its code's note and whether the code is open now (a left
  join on `novedu_codes`, the same window rule as `checkCode`). A range scan over
  the user's rows, plan-checked.
- **Reports** (`listOwnResolvedReportDates`, `lib/report-store.ts`) — the
  Vienna-local dates the user's OWN reports were resolved; nothing else leaves the
  store. A scan of the partial index `ix_novedu_reports_user_id_resolved`,
  plan-checked.
- **Grants** (`listGrants`) — the user's `novedu_achievements` rows.

Coding is visible in the usage because the coding proxy counts each metered
response in `coding_requests` (`docs/usage-metering.md`); requests before that
counter existed are not counted.

The student facts never read `novedu_user_chats`, `novedu_recent_codes` or any
other user's rows. Recently used comes from `lib/recent-code-store.ts` and never
depends on the engine.

## Page and loading

`app/page.tsx` renders the shell at once; each data section is an async server
component behind its own `<Suspense>`. Order on every width: Continue (code field
+ Recently used), the new-badges strip, progress (level/XP + streak), the
calendar, Time to refresh beside Almost there (stacked below `lg`), Badges.
Without a resolvable session only the code field renders.

Sections degrade independently: Level/XP, Almost there and Badges need usage and
grants; the streak and the calendar need usage; the calendar's pins and the strip
need grants. A section whose group failed shows the "could not be loaded" note,
never zeros. Time to refresh needs only the quiz group. When only one of the
keys / quiz / reports groups failed, the badges that read it are left out unless
already stored, everything else renders, and the load is not cached.

## Load protection

A student refreshing in a loop must not load the database.

- **Per-user cache** (`lib/home-cache.ts`): a completed result is reused for 60 s
  per `(userId, audience)` key — a refresh inside the window runs no statement.
  In-process memory is correct because a stage runs at most one replica.
- **Single flight**: concurrent loads of one key share one promise, held in a map
  separate from completed entries; a promise's cleanup removes only its own entry.
- **Generations**: invalidation bumps the key's generation and drops both entries;
  a load publishes only if its generation is unchanged, so a caller after an
  invalidation never receives a load that started before the write.
- **Bound**: at most 2,000 completed entries, oldest evicted; in-flight loads are
  never evicted.
- **Not cached**: a load with any failed group (or a failed grant insert).
- **Invalidation**: `markAchievementsSeen`, `saveQuizResult`,
  `updateUserSettings` and `deleteMyQuizResults` invalidate the user's key;
  everything else is at most 60 s stale.
- React `cache()` shares one load between the sections of a request.

## Saving a quiz result

Quiz grading itself persists nothing. Only on the student's explicit choice does
the Finish page store the attempt's **counts** — never an answer — in
`novedu_quiz_results`, the third sanctioned user↔code link (`docs/codes.md`).

- **Finish page** (`save-result.tsx`). With the setting off it asks "Save this
  result to your personal statistics? Only you can see it — your teacher cannot."
  with **No** (nothing stored; asked again next time), **This time** (one row) and
  **Always** (the row plus the setting on). With the setting on it saves at once
  and says so, linking to Settings. An attempt with nothing answered is never
  saved. The attempt's uuid is minted in the browser when the attempt starts.
- **`saveQuizResult`** (`lib/quiz-actions.ts`) re-runs the quiz verification on
  every call (session, `checkCode`, module = quiz, the quiz re-loaded via
  `verifyAndLoadQuiz` in `lib/quiz-verify.ts`) and rejects — never clamps — a
  non-uuid attempt id, a count that is not a non-negative int4, counts that don't
  sum to `total`, nothing answered, and a `total` above the attempt length the
  server derives (`question_count`, else the pool size). Modes: `this-time`
  writes the row; `always` upserts the setting and writes the row in one
  transaction; `automatic` re-reads the setting inside the transaction and writes
  only while it is on (else the Finish page asks). It returns nothing about the
  quiz.
- **Transaction** (`saveQuizResult` in the store): `pg_advisory_xact_lock` on
  `(user, code)`, then the code row `FOR SHARE` (gone → nothing written), then the
  setting, the insert (`ON CONFLICT DO NOTHING` on `(user_id, id)`) and the prune —
  keep the newest 50 by `(finished_at, id)` plus the best one. `deleteCodesAndData`
  locks its code rows `FOR UPDATE` (in code order) before deleting their dependent
  rows, results included, so a save never lands after its code's delete.
  `updateUserSettings` and `deleteMyQuizResults` take the settings row lock, so
  they serialize with automatic saves.
- **Trust**: the counts come from the browser, so a student can forge their own
  result — accepted: only they see it, and the XP it reaches is bounded.
- **No teacher surface, by construction**: the store's functions are keyed by the
  session user id (plus `deleteResultsForCode`, which returns nothing). A guard
  test (`lib/quiz-result-isolation.unit.test.ts`) fixes its importers —
  `lib/quiz-actions.ts`, `lib/student-facts-store.ts`, `lib/code-stats-store.ts`,
  `lib/user-settings-actions.ts`, `app/settings/page.tsx` — and fails if any other
  module under `lib/` or `app/` names the table.

## Settings page

`/settings`, reached from the user menu by every signed-in user in either role. A
list of sections, each backed by a column of `novedu_user_settings` (a table of
its own: `novedu_user` belongs to better-auth; a missing row means every default).
The page and its actions act only on the session user's own row — no teacher gate,
no bearer route.

- **Quiz results**: the switch "Save my quiz results for my personal statistics"
  (`save_quiz_results`, the Finish page's "Always") with the same privacy notice,
  the number of saved results, and "Delete my saved results", confirmed first.
  Deleting results never revokes an earned badge.
- **Actions** (`lib/user-settings-actions.ts`): `updateUserSettings` validates a
  strict schema (unknown fields reject the call) and upserts;
  `deleteMyQuizResults` deletes the user's rows.

## Error handling

The stores return `undefined` (or `false`) on a database error and never throw.
They never pass the raw error on: a Drizzle error's message embeds the SQL
parameters (user ids, counts), so `reportStoreFailure` logs and records a fixed
`Error("<store>: <op> failed")` plus the SQLSTATE (`sqlState()`) only.

## Tests

- Pure: `lib/achievements/*.unit.test.ts` (DST, New-Year weeks, streaks, exact
  scores, medals, nudges, Refreshed across a pruned gap, every rule at/below/above
  its threshold, evaluation, XP boundaries, the catalog guard).
- Cache: `lib/home-cache.unit.test.ts`. Stores and actions:
  `lib/achievement-store.unit.test.ts`, `lib/quiz-result-store.unit.test.ts`
  (transaction shape, fixed failure messages), `lib/achievement-actions.unit.test.ts`,
  `lib/user-settings-actions.unit.test.ts`, `saveQuizResult` in
  `lib/quiz-actions.unit.test.ts`, the guard `lib/quiz-result-isolation.unit.test.ts`.
  Loader: `lib/home-data.unit.test.ts`.
- Sections: `app/_home/sections.unit.test.tsx`, shell: `app/page.unit.test.tsx`.
- Browser: `app/_home/*.browser.test.tsx` (calendar keyboard/tooltip/phone layout,
  the seen marker, the disclosures), `app/[code]/_quiz/save-result.browser.test.tsx`
  (the three choices, the automatic save), `app/settings/*.browser.test.tsx`.
- E2E: `e2e/home.spec.ts` (hermetic smoke per visitor kind, including a fresh
  student's empty state) and `e2e/home.live.spec.ts` (`@live-db`: seeded usage and
  grant, the strip cleared after the visit, DST grouping, both plans; seeded coding
  requests and a key earning the Coding badges and In the Zone), `e2e/settings.spec.ts`
  (hermetic: reached from the user menu, the switch persists) and
  `e2e/quiz-results.live.spec.ts` (`@live-db`: the prune under two concurrent saves,
  a save racing a code delete, `always` rolling back, an automatic save racing the
  switch-off, seeded results on the start page and deleted from Settings, a code
  delete dropping results, both new plans). The Finish page's choices need a graded
  answer, i.e. an LLM, so they are covered by the component tests.
