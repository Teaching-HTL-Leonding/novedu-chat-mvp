// The student-mode cookie NAME, alone in a module that imports nothing — so
// callers outside the Next server runtime can spell it from the same source.
// `lib/student-mode.ts` (the rule) imports `next/headers`, which the Playwright
// specs cannot load; they set the cookie directly and import the name from here.
export const STUDENT_MODE_COOKIE = "student-mode";
