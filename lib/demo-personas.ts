// The four demo personas a demo build offers on its sign-in page (docs/auth.md,
// "Demo mode"). Client-safe — the sign-in buttons need it — and loaded ONLY through
// `process.env.NOVEDU_AUTH_MODE === "demo"` branches (dynamic imports), so an Entra
// build carries none of it (scripts/ci/check-demo-markers.mjs proves that).
//
// Two teachers show that a teacher's codes are scoped to their creator; two students
// show the per-student views.

/**
 * The one password of every persona. PUBLIC by design — the sign-in page sends it
 * with each button — and doubling as a build marker: its literal survives
 * minification, so its presence in compiled output identifies a demo build.
 */
export const DEMO_PASSWORD = "novedu-demo-login-not-a-secret";

export interface DemoPersona {
  /** `novedu_user.id`; also the credential account's `account_id`. */
  id: string;
  /** `novedu_account.id` of the persona's credential account. */
  accountId: string;
  name: string;
  givenName: string;
  email: string;
  /** Seeded into `novedu_user.is_teacher`. */
  role: "teacher" | "student";
}

function persona(id: string, name: string, role: DemoPersona["role"]): DemoPersona {
  const [givenName = name, surname = ""] = name.split(" ");
  return {
    id,
    accountId: `${id}-credential`,
    name,
    givenName,
    email: `${givenName}.${surname}@demo.novedu.invalid`.toLowerCase(),
    role,
  };
}

export const DEMO_PERSONAS: readonly DemoPersona[] = [
  persona("demo-teacher-1", "Anna Berger", "teacher"),
  persona("demo-teacher-2", "Lukas Huber", "teacher"),
  persona("demo-student-1", "Mia Gruber", "student"),
  persona("demo-student-2", "Noah Wagner", "student"),
];
