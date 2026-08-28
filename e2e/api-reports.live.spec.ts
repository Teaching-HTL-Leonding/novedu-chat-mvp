import { expect, test } from "@playwright/test";
import { mintToken } from "./api-auth.utils";
import { deleteCode, deleteReportsByCode, mintTutorCode } from "./code.utils";

// @live-db lifecycle of the /api/reports bearer channel over real HTTP against
// the real database, closing the CLI report-triage loop end-to-end: a STUDENT
// files a chat report through the real UI (the filing steps of reports.spec.ts),
// then the TEACHER drives the three bearer routes — GET /api/reports finds it →
// GET /api/reports/<id> returns it with the embedded transcript → POST
// /api/reports/resolve stamps it → GET /api/reports?status=resolved shows it
// resolved by the teacher token's oid. It needs the real database (minted code +
// the written novedu_reports row + DB-side filtering) but NEVER the LLM: a report
// can reference a ZERO-MESSAGE thread by design, so the chat page only renders and
// nothing calls the model. Hence @live-db (NOT @live-llm), running in CI against
// the SQL container.
//
// The default chromium project runs as the STUDENT (its storageState), which files
// the report; the API is driven with an explicitly minted TEACHER bearer token
// (real env issuer/audience, e2e signing key — like api-management.live.spec.ts).
// The `request` fixture may carry the student's cookies, but the bearer routes are
// proxy-excluded and self-gate on the token, so cookies are ignored on this path.
// The code is minted with created_by = "e2e-test-suite" (mintTutorCode), NOT the
// teacher token's oid, so the API is always queried with mine=0 to defeat the
// "Only my codes" default filter.

// Dev compilation of /[code] + the routes + DB round-trips; a report references a
// zero-message thread, so no LLM latency is involved.
test.setTimeout(120_000);

// Best-effort cleanup: deleteCode drops only the code row, so the report rows are
// removed explicitly (a raw code delete does NOT cascade to reports the way the
// app's own delete transaction does). Cleaned even on a mid-test failure so no
// strays leak into the shared dev database.
let mintedCode: string | null = null;

test.afterEach(async () => {
  if (!mintedCode) return;
  const code = mintedCode;
  mintedCode = null;
  try {
    await deleteReportsByCode(code);
    await deleteCode(code);
  } catch {
    // best-effort
  }
});

test("file a chat report through the UI, then list → show → resolve it over the bearer API", {
  tag: ["@live", "@live-db"],
}, async ({ page, request }) => {
  const marker = `e2e-api-report-${Date.now()}`;
  // The default fixture tutor pins the fake `test-model`; a zero-message report
  // never touches it, so this is deliberately NOT the live-model tutor.
  const code = await mintTutorCode({ note: `e2e api report code ${Date.now()}` });
  mintedCode = code;

  // ---------------------------------------------------------------------------
  // STUDENT — open the chat and file a report (no message is ever sent), reusing
  // the filing steps of reports.spec.ts.
  // ---------------------------------------------------------------------------
  await page.goto(`/${code}`);
  await expect(page.getByPlaceholder("Type a message...")).toBeVisible({ timeout: 60_000 });

  await page.getByRole("button", { name: "Report" }).click();
  // The MANDATORY attribution notice — reports waive anonymity — must be shown.
  await expect(page.getByText(/Reports are not anonymous/i)).toBeVisible();
  await page.getByRole("button", { name: "Holy sh.." }).click();
  await page.getByLabel(/What happened/i).fill(`${marker} the tutor said something wild`);
  await page.getByRole("button", { name: "Send report" }).click();
  await expect(page.getByText(/your teacher will take a look/i)).toBeVisible({ timeout: 30_000 });

  // ---------------------------------------------------------------------------
  // TEACHER — drive the bearer API over HTTP with a minted teacher token.
  // ---------------------------------------------------------------------------
  const headers = {
    authorization: `Bearer ${await mintToken({ teacher: true, name: "E2E Api Teacher", ttlSeconds: 600 })}`,
  };

  // LIST: mine=0 (the code's creator is the e2e mint identity, not the teacher
  // token's oid), q=marker narrows the DB-side search to this run's row.
  const listRes = await request.get(`/api/reports?mine=0&q=${encodeURIComponent(marker)}`, {
    headers,
  });
  expect(listRes.status()).toBe(200);
  const list = await listRes.json();
  expect(Array.isArray(list)).toBe(true);
  const report = list.find((r: { code: string }) => r.code === code);
  expect(report, "the freshly filed report is in the open list").toBeDefined();
  expect(report).toMatchObject({
    kind: "chat",
    code,
    reaction: "holysh",
    resolvedAt: null,
    resolvedBy: null,
  });
  expect(report.description).toContain(marker);
  expect(typeof report.threadId).toBe("string");
  const id: string = report.id;

  // SHOW: returns the same report plus the embedded chat transcript — a `messages`
  // array (may be empty for a zero-message thread), the chat-kind projection.
  const showRes = await request.get(`/api/reports/${id}`, { headers });
  expect(showRes.status()).toBe(200);
  const detail = await showRes.json();
  expect(detail).toMatchObject({ id, kind: "chat", code });
  expect(Array.isArray(detail.messages)).toBe(true);

  // RESOLVE: bulk-by-id, stamps resolved_at + resolved_by = the teacher token oid.
  const resolveRes = await request.post("/api/reports/resolve", {
    headers,
    data: { ids: [id] },
  });
  expect(resolveRes.status()).toBe(200);
  expect(await resolveRes.json()).toEqual({ ok: true });

  // LIST resolved: it now shows up under status=resolved, stamped.
  const resolvedRes = await request.get(
    `/api/reports?mine=0&status=resolved&q=${encodeURIComponent(marker)}`,
    { headers },
  );
  expect(resolvedRes.status()).toBe(200);
  const resolvedList = await resolvedRes.json();
  const resolvedReport = resolvedList.find((r: { id: string }) => r.id === id);
  expect(resolvedReport, "the report now appears in the resolved list").toBeDefined();
  expect(resolvedReport.resolvedAt).not.toBeNull();
  // Attributed to the authenticated teacher — the token's oid.
  expect(resolvedReport.resolvedBy).toBe("e2e-api-oid");
});
