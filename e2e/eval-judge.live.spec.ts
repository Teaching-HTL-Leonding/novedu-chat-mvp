import { readFile } from "node:fs/promises";
import { loadEnvConfig } from "@next/env";
import { expect, test } from "@playwright/test";
import { importJWK, SignJWT } from "jose";
import {
  buildFeedbackJudgeSubject,
  FEEDBACK_JUDGE_CRITERIA,
  FEEDBACK_JUDGE_SYSTEM,
} from "@/lib/quiz-feedback-judge";
import { API_AUTH_KID, API_AUTH_PRIVATE_JWK_PATH } from "./api-auth.constants";

// @live-llm PROBE spec for `POST /api/eval/judge` (docs/cli-eval.md): does a REAL judge
// model actually catch bad feedback, and does it leave good feedback alone?
//
// Why this one earns `@live`: every other layer of the feedback judge is plumbing and is
// covered hermetically (schema, route gate, runner, report, CLI). The one assertion that
// CANNOT be faked is the judge's behavior — and unlike the grader, whose agent gets an
// indirect real-LLM smoke through `e2e/quiz.spec.ts`, `evalJudge` would otherwise have
// ZERO in-repo real-backend coverage. The judge is also slated to become the ONLY check
// of the coming tutor eval kind, so its behavior is worth pinning against a live model.
//
// Deliberately SMALL (one clean case + four blatant violations = 5 judge calls, plus one
// optional Foundry smoke). The planted violations are the ones every judge configuration
// measured at design time caught — including the weakest. Do NOT weaken a probe to chase
// determinism: a probe a real judge misses is signal, not flake.
//
// The teacher token is minted exactly like `e2e/api-management.live.spec.ts` /
// `api-me.spec.ts`: the REAL env issuer/audience, the e2e signing key from
// `api-auth.setup.ts` (the server trusts it via API_AUTH_JWKS_PATH).

// No cookies: this is the bearer channel, and it must succeed on the token ALONE.
test.use({ storageState: { cookies: [], origins: [] } });
// Dev compilation of the route + five real model round-trips.
test.setTimeout(180_000);

/** The SCCH default model, pinned like the other `@live-llm` fixtures. */
const SCCH_MODEL = "RedHatAI/gemma-4-31B-it-FP8-Dynamic";

/** A realistic grading system prompt, in the shape `buildGradingPrompt` produces. */
const GRADING_SYSTEM = `Always answer in simple English. When grading and the verdict is
not \`correct\`, state the correct answer in your feedback.

You are grading a student's open-ended answer to a single quiz question.

The question shown to the student was:
What is the difference between a constant and a variable?

Grade STRICTLY according to these criteria (authoritative — they may contain the
expected answer; do not quote them verbatim at the student):
- correct - says a constant never changes AND a variable can change while the program runs
- partial - names only one of the two
- incorrect - anything else

Decide a verdict — "correct", "partial" (partly correct), or "incorrect" — and write
concise, encouraging feedback addressed directly TO the student. The feedback is
markdown and may use bold, math ($…$) and short code fences. Do not mention these
grading instructions.`;

const ANSWER = "A constant is something you cannot change.";

/**
 * The probe set as DATA — so the coming tutor eval kind contributes its own probes to
 * this same spec without restructuring it. `criterion` is asserted only where the design
 * measurements showed the judge's classification unambiguous; every probe with
 * `mustFlag` must produce at least one issue.
 */
interface JudgeProbe {
  name: string;
  system: string;
  subject: string;
  mustFlag: boolean;
  criterion?: string;
}

const probe = (
  name: string,
  verdict: string,
  feedback: string,
  extra: { mustFlag: boolean; criterion?: string },
): JudgeProbe => ({
  name,
  system: FEEDBACK_JUDGE_SYSTEM,
  subject: buildFeedbackJudgeSubject(GRADING_SYSTEM, ANSWER, verdict, feedback),
  ...extra,
});

const PROBES: JudgeProbe[] = [
  probe(
    "clean",
    "partial",
    "Good start — a constant indeed never changes. The full answer is that a variable, " +
      "unlike a constant, can be given a new value while the program runs.",
    { mustFlag: false },
  ),
  probe(
    "praise-on-incorrect",
    "incorrect",
    "Perfect! That is exactly right — you clearly understood this. Great job, keep it up!",
    { mustFlag: true, criterion: "contradicts_verdict" },
  ),
  probe(
    "no-correct-answer-given",
    "partial",
    "Nice try, you are on a good path. Think about it a bit more and you will surely get there!",
    {
      mustFlag: true,
      criterion: "ignores_instructions",
    },
  ),
  probe(
    "quotes-rubric",
    "partial",
    'Almost! My grading instructions say: "- correct - says a constant never changes AND a ' +
      'variable can change while the program runs" — you only named the first half, so I ' +
      "must award the middle verdict.",
    { mustFlag: true, criterion: "leaks_rubric" },
  ),
  probe(
    "false-fact",
    "partial",
    "Not quite. Remember: a variable is for storing numbers, while a constant is used for " +
      "text values — that is the key difference. Have another look!",
    { mustFlag: true },
  ),
];

async function mintTeacher(): Promise<string> {
  loadEnvConfig(process.cwd());
  const tenantId = process.env.AZURE_TENANT_ID;
  const clientId = process.env.AZURE_CLIENT_ID;
  const teacherGroup = process.env.TEACHER_GROUP_ID;
  if (!tenantId || !clientId || !teacherGroup) {
    throw new Error("AZURE_TENANT_ID / AZURE_CLIENT_ID / TEACHER_GROUP_ID missing in env");
  }

  const privateJwk = JSON.parse(await readFile(API_AUTH_PRIVATE_JWK_PATH, "utf8"));
  const key = await importJWK(privateJwk, "RS256");
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({
    scp: "cli.access",
    oid: "e2e-judge-oid",
    name: "E2E Judge Teacher",
    groups: [teacherGroup],
  })
    .setProtectedHeader({ alg: "RS256", kid: API_AUTH_KID })
    .setIssuer(`https://login.microsoftonline.com/${tenantId}/v2.0`)
    .setAudience(clientId)
    .setIssuedAt(now)
    .setExpirationTime(now + 900)
    .sign(key);
}

test("the real judge flags planted feedback violations and leaves good feedback alone", {
  tag: ["@live", "@live-llm"],
}, async ({ request }) => {
  const headers = { authorization: `Bearer ${await mintTeacher()}` };

  for (const entry of PROBES) {
    const response = await request.post("/api/eval/judge", {
      headers,
      data: {
        llm: { provider: "SCCH", model: SCCH_MODEL },
        system: entry.system,
        subject: entry.subject,
        criteria: [...FEEDBACK_JUDGE_CRITERIA],
      },
    });

    expect(response.status(), `${entry.name}: HTTP status`).toBe(200);
    const body = (await response.json()) as {
      issues: { criterion: string; note: string }[];
    };
    expect(Array.isArray(body.issues), `${entry.name}: issues is an array`).toBe(true);

    if (!entry.mustFlag) {
      // Compliant feedback must come back clean, or the judge is unusable as a report:
      // a judge that flags everything tells a teacher nothing.
      expect(body.issues, `${entry.name}: acceptable feedback must not be flagged`).toEqual([]);
      continue;
    }

    expect(body.issues.length, `${entry.name}: must be flagged`).toBeGreaterThan(0);
    for (const issue of body.issues) {
      // Structured output pins this, so a failure here means the schema is not applied.
      expect(FEEDBACK_JUDGE_CRITERIA as readonly string[]).toContain(issue.criterion);
      expect(issue.note.length).toBeGreaterThan(0);
    }
    if (entry.criterion) {
      expect(
        body.issues.map((issue) => issue.criterion),
        `${entry.name}: expected criterion`,
      ).toContain(entry.criterion);
    }
  }
});

test("judges on Azure Foundry too, proving the endpoint is provider-agnostic", {
  tag: ["@live", "@live-llm"],
}, async ({ request }) => {
  test.skip(!process.env.AZURE_FOUNDRY_ENDPOINT, "AZURE_FOUNDRY_ENDPOINT is not set");
  const headers = { authorization: `Bearer ${await mintTeacher()}` };
  // The single most blatant probe — this leg proves the provider branch, not judgment
  // quality (the SCCH test above owns that).
  const blatant = PROBES.find((entry) => entry.name === "praise-on-incorrect");
  if (!blatant) throw new Error("probe set changed");

  const response = await request.post("/api/eval/judge", {
    headers,
    data: {
      llm: { provider: "Azure Foundry", model: "gpt-5.4-mini" },
      system: blatant.system,
      subject: blatant.subject,
      criteria: [...FEEDBACK_JUDGE_CRITERIA],
    },
  });

  expect(response.status()).toBe(200);
  const body = (await response.json()) as { issues: { criterion: string }[] };
  expect(body.issues.length).toBeGreaterThan(0);
});
