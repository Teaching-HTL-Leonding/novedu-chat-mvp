import { expect, type Page, test } from "@playwright/test";
import { STUDENT_MODE_COOKIE } from "../lib/student-mode-constants";
import { STORAGE_STATE, TEACHER_STORAGE_STATE } from "./auth.constants";
import { sendAndExpectReply } from "./chat.utils";
import { LIVE_TUTOR_URL, mintCode } from "./code.utils";

// Reasoning display is TEACHER-ONLY, and "teacher-only" here means the chain of
// thought must never be WRITTEN to a student's stream — not merely hidden in the
// DOM (docs/chat.md). A CSS-level assertion would prove nothing, so this spec
// records the raw `/api/copilotkit/agent/tutor/{run,connect}` SSE bytes the
// BROWSER received and counts `REASONING_` frames.
//
// The three legs run SERIALLY against ONE code, and in this order on purpose:
// the teacher leg first establishes that this exact activity really does produce
// reasoning frames, so the two zero-frame assertions that follow cannot pass
// merely because nothing was thinking.
//
//  1. an effective teacher            → reasoning frames present
//  2. the same teacher, view-as-student → zero
//  3. a genuine student session        → zero
//
// Needs a REASONING model, so the code carries a per-code LLM override pair on
// top of the plain live tutor fixture.

test.use({ storageState: TEACHER_STORAGE_STATE });
test.describe.configure({ mode: "serial" });

const REASONING_LLM = {
  provider: "SCCH",
  model: "Qwen/Qwen3.8-27B-FP8",
  reasoning: "medium",
} as const;

const QUESTION = "A train travels 120 km in 90 minutes. What is its average speed in km/h?";

/** One recorded runtime stream: the endpoint, and the bytes received so far. */
interface CapturedStream {
  path: string;
  text: string;
}

/**
 * Tees every runtime SSE body INSIDE the page, so the bytes are recorded as they
 * arrive. Reading the whole response instead would deadlock on `connect`, which
 * holds its stream open for the life of the chat: those bytes are exactly the
 * ones a leaked replay would ride on, so they must be captured, not waited for.
 *
 * Install before the first navigation — it runs on every document.
 */
async function captureRuntimeStreams(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const streams: CapturedStream[] = [];
    (window as unknown as { __runtimeStreams: CapturedStream[] }).__runtimeStreams = streams;

    const original = window.fetch;
    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const response = await original(input, init);
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      const path = new URL(url, window.location.origin).pathname;
      if (!/^\/api\/copilotkit\/agent\/[^/]+\/(run|connect)$/.test(path) || !response.body) {
        return response;
      }

      const entry: CapturedStream = { path, text: "" };
      streams.push(entry);
      const [toApp, toRecorder] = response.body.tee();
      void (async () => {
        const reader = toRecorder.getReader();
        const decoder = new TextDecoder();
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          entry.text += decoder.decode(value, { stream: true });
        }
      })();

      // Hand the app an identical response over the untouched half of the tee.
      return new Response(toApp, {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
      });
    };
  });
}

/** Everything recorded so far, after a short settle for the last chunks. */
async function readRuntimeStreams(page: Page): Promise<CapturedStream[]> {
  await page.waitForTimeout(2_000);
  return page.evaluate(
    () => (window as unknown as { __runtimeStreams?: CapturedStream[] }).__runtimeStreams ?? [],
  );
}

/** How many frames of a given AG-UI event type the recorded streams carried. */
function countFrames(streams: CapturedStream[], type: string): number {
  return streams.reduce((total, stream) => total + stream.text.split(type).length - 1, 0);
}

/** Assert a student's capture: an answer arrived, and not one reasoning frame did. */
function expectStudentStreams(streams: CapturedStream[]): void {
  expect(streams.length, "no runtime stream was recorded").toBeGreaterThan(0);
  // Every body — `connect` replays included, since a reload reads the thread back
  // through it.
  for (const stream of streams) expect(stream.text, stream.path).not.toMatch(/REASONING_/);
  // …while the answer streamed normally, which also proves the capture is not
  // silently empty, so nothing else was collateral damage.
  expect(countFrames(streams, "TEXT_MESSAGE_CONTENT")).toBeGreaterThan(0);
}

// The activity all three legs share, so the teacher leg's evidence applies to the
// student legs verbatim.
let code: string;
// Set by the teacher leg; the student legs refuse to draw a conclusion without it.
let teacherReasoningFrames = 0;

test.beforeAll(async () => {
  code = await mintCode({
    module: "tutor",
    file: LIVE_TUTOR_URL,
    llm: REASONING_LLM,
    note: "e2e reasoning visibility",
  });
});

// A real reasoning-model round-trip — give it room.
test.setTimeout(240_000);

// @live: needs the real SCCH endpoint + Azure SQL — excluded in CI (test:e2e:ci).
test("an effective teacher receives the reasoning and sees the thinking block", {
  tag: ["@live", "@live-llm"],
}, async ({ page }) => {
  await captureRuntimeStreams(page);
  await page.goto(`/${code}`);
  await sendAndExpectReply(page, { message: QUESTION, timeout: 120_000 });

  // The collapsible reasoning block ("Thinking…" while streaming, "Thought for
  // Ns" once done) is the visible half.
  await expect(page.getByText(/Thought for|Thinking…/).first()).toBeVisible({ timeout: 60_000 });

  // ...and the frames really were on the wire.
  const streams = await readRuntimeStreams(page);
  expect(countFrames(streams, "TEXT_MESSAGE_CONTENT")).toBeGreaterThan(0);
  teacherReasoningFrames = countFrames(streams, "REASONING_MESSAGE_CONTENT");
  expect(teacherReasoningFrames).toBeGreaterThan(0);
});

// @live: needs the real SCCH endpoint + Azure SQL — excluded in CI (test:e2e:ci).
test("a teacher in view-as-student mode receives ZERO reasoning frames", {
  tag: ["@live", "@live-llm"],
}, async ({ page }) => {
  // Same session, same model, same activity — only the student-mode cookie
  // differs. Setting it directly keeps this spec about the reasoning gate; the
  // user-menu enter/exit journey is `e2e/student-mode.spec.ts`'s job.
  expect(teacherReasoningFrames, "the teacher leg must prove this code thinks").toBeGreaterThan(0);
  await page
    .context()
    .addCookies([{ name: STUDENT_MODE_COOKIE, value: "1", domain: "localhost", path: "/" }]);

  await captureRuntimeStreams(page);
  await page.goto(`/${code}`);

  const composer = page.getByTestId("copilot-chat-textarea");
  await expect(composer).toBeVisible({ timeout: 30_000 });
  await composer.fill(QUESTION);
  await page.getByTestId("copilot-send-button").click();

  // While the run is in flight the student sees the generic note instead of the
  // chain of thought (ModuleChat's `cursor` slot).
  await expect(page.getByTestId("chat-generating-note")).toBeVisible({ timeout: 60_000 });

  const assistant = page.getByTestId("copilot-assistant-message").last();
  await expect(assistant).toBeVisible({ timeout: 120_000 });
  await expect
    .poll(async () => (await assistant.innerText()).trim().length, { timeout: 120_000 })
    .toBeGreaterThan(0);

  expectStudentStreams(await readRuntimeStreams(page));

  // And no thinking block is in the DOM either.
  await expect(page.getByText(/Thought for/)).toHaveCount(0);
});

// @live: needs the real SCCH endpoint + Azure SQL — excluded in CI (test:e2e:ci).
test("a real student session receives ZERO reasoning frames", {
  tag: ["@live", "@live-llm"],
}, async ({ browser }) => {
  // The genuine article: the default (student) storage state, no cookie games —
  // the case the view-as-student leg only SIMULATES.
  expect(teacherReasoningFrames, "the teacher leg must prove this code thinks").toBeGreaterThan(0);
  const context = await browser.newContext({ storageState: STORAGE_STATE });
  const page = await context.newPage();
  try {
    await captureRuntimeStreams(page);
    await page.goto(`/${code}`);
    await sendAndExpectReply(page, { message: QUESTION, timeout: 120_000 });

    expectStudentStreams(await readRuntimeStreams(page));
    await expect(page.getByText(/Thought for/)).toHaveCount(0);
  } finally {
    await context.close();
  }
});
