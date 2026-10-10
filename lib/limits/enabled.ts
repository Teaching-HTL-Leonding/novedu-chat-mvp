import { LIMITS } from "./config";

// The environment switch for the student limits. FAIL-CLOSED: limits are ON
// unless an operator sets `LIMITS_ENABLED=false` (case-insensitive, surrounding
// whitespace tolerated, as `.env` files collect it) — a typo or an unset
// variable must never silently switch off cost protection in production. Local
// development sets it to `false` when the limits get in the way.
//
// Read lazily on every call, so a test can stub the variable per case.
//
// SERVER-ONLY and APP-ONLY: the CLI bundle must stay env-free.

/** False only when `LIMITS_ENABLED` is explicitly `false`. */
export function limitsEnabled(): boolean {
  return process.env.LIMITS_ENABLED?.trim().toLowerCase() !== "false";
}

/**
 * True when no limit applies to this caller: limits are switched off, or the
 * caller counts as a teacher. This module reads no role: the CALLER resolves
 * `teacher` for its channel — the chat passes the EFFECTIVE teacher (a teacher
 * in "view as student" mode passes `false` and is limited like a student), the
 * coding proxy the key holder's server-owned `novedu_user.is_teacher`.
 */
export function isLimitExempt(caller: { teacher: boolean }): boolean {
  return !limitsEnabled() || (LIMITS.exemptTeachers && caller.teacher);
}
