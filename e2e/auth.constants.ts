import path from "node:path";

// Shared between the Playwright config and the auth setup. Kept in its own module
// (free of `test()` calls) so the config can import it without Playwright
// complaining that test() was called at config-load time.

// Dev runs over http://localhost, so the session cookie is the non-secure name.
export const COOKIE_NAME = "authjs.session-token";

// Where the minted authenticated sessions are stored. The default (student)
// state drives the chromium project; specs that exercise teacher-only features
// opt into the teacher state via `test.use({ storageState: TEACHER_STORAGE_STATE })`.
export const STORAGE_STATE = path.join("e2e", ".auth", "state.json");
export const TEACHER_STORAGE_STATE = path.join("e2e", ".auth", "teacher-state.json");
