import type { Session } from "@/auth";

// The stubbed `auth.api.getSession` shape for bearer-route unit tests: every
// `vi.mock("@/auth", ...)` site resolves to this instead of a real better-auth
// session. Kept in ONE place so the shape only needs fixing once if better-auth
// changes it — see lib/api-auth.unit.test.ts and the app/api/** route tests.

/** Builds a `{ session, user }` pair assignable to `Session`, for a mocked `getSession`. */
export function bearerSession({
  id = "u1",
  name = "User",
  isTeacher = false,
  email,
}: {
  id?: string;
  name?: string;
  isTeacher?: boolean;
  email?: string;
} = {}): Session {
  const now = new Date();
  return {
    session: {
      id: `session-${id}`,
      token: `token-${id}`,
      userId: id,
      expiresAt: new Date(now.getTime() + 24 * 60 * 60 * 1000),
      createdAt: now,
      updatedAt: now,
      ipAddress: null,
      userAgent: null,
    },
    user: {
      id,
      name,
      email: email ?? `${id}@example.com`,
      emailVerified: true,
      image: null,
      isTeacher,
      createdAt: now,
      updatedAt: now,
    },
  } satisfies Session;
}
