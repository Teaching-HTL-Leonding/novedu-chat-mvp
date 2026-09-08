import path from "node:path";

// Shared between the Playwright config and the auth setup. Kept in its own module
// (free of `test()` calls) so the config can import it without Playwright
// complaining that test() was called at config-load time.

// The app's own cookie prefix (`advanced.cookiePrefix` in auth.ts). Dev runs over
// http://localhost, so this is the non-secure name — better-auth prefixes it with
// `__Secure-` only under an https baseURL.
export const COOKIE_NAME = "novedu.session_token";

/**
 * The two e2e principals. `auth.setup.ts` creates one `novedu_user` row per
 * principal (the session rows reference them) and mints a session cookie for
 * each; specs and DB helpers key on the same ids and names, so a rename here
 * follows through everywhere.
 */
export const E2E_STUDENT = {
  id: "e2e-student",
  name: "E2E Student",
  email: "e2e-student@example.com",
} as const;

export const E2E_TEACHER = {
  id: "e2e-teacher",
  name: "E2E Teacher",
  email: "e2e-teacher@example.com",
} as const;

// Where the minted authenticated sessions are stored. The default (student)
// state drives the chromium project; specs that exercise teacher-only features
// opt into the teacher state via `test.use({ storageState: TEACHER_STORAGE_STATE })`.
export const STORAGE_STATE = path.join("e2e", ".auth", "state.json");
export const TEACHER_STORAGE_STATE = path.join("e2e", ".auth", "teacher-state.json");
