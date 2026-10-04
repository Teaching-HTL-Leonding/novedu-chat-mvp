import { expect, test } from "@playwright/test";
import { sql } from "drizzle-orm";
import { insertGrants } from "@/lib/achievement-store";
import { addDays, todayLocal } from "@/lib/achievements/time";
import { getDb } from "@/lib/db";
import { loadStudentUsage, usageStatement } from "@/lib/student-facts-store";
import { query } from "./db";
import { deletePrincipal, signInFreshStudent } from "./principal.utils";

// The start page against real rows (docs/home.md): seeded hourly usage and one
// unseen badge for a FRESH student, so nothing another spec wrote can interfere.
// Covers the calendar's intensity, the pin on its `qualified_on` day, the strip,
// and that the strip is gone once the badges were marked seen — plus the facts
// store against the real database: the Vienna-day grouping across the autumn
// clock change, the idempotent grant insert, and the usage statement's plan.

test.use({ storageState: { cookies: [], origins: [] } });

/** A UTC hour bucket on a Vienna-local date (10:00Z is 11:00/12:00 local, same day). */
const bucket = (date: string, hourUtc: number) =>
  `${date}T${String(hourUtc).padStart(2, "0")}:00:00Z`;

test("the start page shows seeded activity, pins a badge on its day, and clears the strip once seen", {
  tag: ["@live", "@live-db"],
}, async ({ page, context }) => {
  const principal = await signInFreshStudent(context, "Seeded Student");
  const today = todayLocal(new Date());
  const busyDay = addDays(today, -1);
  const quietDay = addDays(today, -8);
  const pinDay = addDays(today, -2);

  try {
    const rows: [string, number, number][] = [
      // busyDay: 3 active hours → intensity 2 (2–3 hours).
      [bucket(busyDay, 8), 2, 0],
      [bucket(busyDay, 9), 0, 4],
      [bucket(busyDay, 10), 1, 0],
      // pinDay and quietDay: 1 active hour each → intensity 1.
      [bucket(pinDay, 10), 1, 0],
      [bucket(quietDay, 10), 1, 0],
      // The autumn clock change of 2025: both buckets are local 02:00 on 26 Oct.
      ["2025-10-26T00:00:00Z", 1, 0],
      ["2025-10-26T01:00:00Z", 1, 0],
    ];
    for (const [hour, messages, answers] of rows) {
      await query(
        `INSERT INTO novedu_usage_by_user (user_id, hour, user_messages, quiz_answers)
         VALUES ($1, $2, $3, $4)`,
        [principal.id, hour, messages, answers],
      );
    }
    // A token-only bucket is not an active hour.
    await query(
      `INSERT INTO novedu_usage_by_user (user_id, hour, output_tokens) VALUES ($1, $2, 500)`,
      [principal.id, bucket(addDays(today, -3), 10)],
    );
    // One badge, not yet seen, pinned to pinDay.
    await query(
      `INSERT INTO novedu_achievements (user_id, achievement_id, qualified_on) VALUES ($1, 'week-days-3', $2)`,
      [principal.id, pinDay],
    );

    await page.goto("/");

    // The strip announces the new badges (the seeded one, plus any the visit granted).
    await expect(
      page.getByText(/You earned \d+ new badges? since your last visit\./),
    ).toBeVisible();

    // Calendar intensity per Vienna-local day; the token-only day stays empty.
    await expect(page.locator(`[data-date="${busyDay}"]`)).toHaveAttribute("data-level", "2");
    await expect(page.locator(`[data-date="${quietDay}"]`)).toHaveAttribute("data-level", "1");
    await expect(page.locator(`[data-date="${addDays(today, -3)}"]`)).toHaveAttribute(
      "data-level",
      "0",
    );

    // The pin sits on its qualified_on day, marked new.
    const pin = page.locator(`[data-date="${pinDay}"] button`);
    await expect(pin).toHaveAccessibleName(/Three-Day Week, earned .*, new since your last visit/);

    // The client marks every announced badge as seen…
    await expect
      .poll(
        async () =>
          (
            await query<{ unseen: string }>(
              `SELECT count(*) AS unseen FROM novedu_achievements WHERE user_id = $1 AND seen_at IS NULL`,
              [principal.id],
            )
          )[0]?.unseen,
      )
      .toBe("0");
    // …so the next visit (past the action's cache invalidation) shows no strip.
    await page.reload();
    await expect(page.getByRole("heading", { name: "Your last 26 weeks" })).toBeVisible();
    await expect(page.getByText(/new badges? since your last visit/)).toHaveCount(0);
    // (Other badges this visit granted may share the day; none is new any more.)
    const pinName = await page.locator(`[data-date="${pinDay}"] button`).getAttribute("aria-label");
    expect(pinName).toContain("Three-Day Week, earned");
    expect(pinName).not.toContain("new since your last visit");

    // The facts store: both autumn 02:00 buckets are two active hours of one day.
    const usage = await loadStudentUsage(principal.id);
    expect(usage?.find((d) => d.date === "2025-10-26")).toEqual({
      date: "2025-10-26",
      activeHours: 2,
      quizAnswers: 0,
      writingSaves: 0,
    });
    expect(usage?.some((d) => d.date === addDays(today, -3))).toBe(false);

    // A repeated grant insert is a no-op: the stored date is never overwritten.
    const grants = await insertGrants(
      principal.id,
      [{ id: "week-days-3", qualifiedOn: "2020-01-01" }],
      [],
    );
    expect(grants?.find((g) => g.id === "week-days-3")?.qualifiedOn).toBe(pinDay);

    // The usage statement is a range scan on the PK (its leading column is user_id).
    const plan = await getDb().transaction(async (tx) => {
      await tx.execute(sql`SET LOCAL enable_seqscan = off`);
      const res = await tx.execute<{ "QUERY PLAN": unknown }>(
        sql`EXPLAIN (FORMAT JSON) ${usageStatement(principal.id)}`,
      );
      return JSON.stringify(res.rows[0]?.["QUERY PLAN"]);
    });
    expect(plan).toContain("novedu_usage_by_user_pkey");
    expect(plan).not.toContain('"Seq Scan"');
  } finally {
    await query(`DELETE FROM novedu_usage_by_user WHERE user_id = $1`, [principal.id]).catch(
      () => {},
    );
    await query(`DELETE FROM novedu_achievements WHERE user_id = $1`, [principal.id]).catch(
      () => {},
    );
    await deletePrincipal(principal.id).catch(() => {});
  }
});
