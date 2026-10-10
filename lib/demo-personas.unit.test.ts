import { describe, expect, it } from "vitest";
import { DEMO_PASSWORD, DEMO_PERSONAS } from "@/lib/demo-personas";

// The four demo personas (docs/auth.md, "Demo mode"). Their ids, account ids and
// emails are what the seed upserts by, so each must be unique; the emails must be
// undeliverable (`.invalid`) since they are public.

describe("DEMO_PERSONAS", () => {
  it("are two teachers and two students", () => {
    expect(DEMO_PERSONAS.map((p) => p.role).sort()).toEqual([
      "student",
      "student",
      "teacher",
      "teacher",
    ]);
  });

  it("have unique ids, account ids and emails", () => {
    for (const key of ["id", "accountId", "email"] as const) {
      expect(new Set(DEMO_PERSONAS.map((p) => p[key])).size).toBe(4);
    }
  });

  it("use the demo- id prefix, <id>-credential account ids and .invalid emails", () => {
    for (const persona of DEMO_PERSONAS) {
      expect(persona.id).toMatch(/^demo-(teacher|student)-\d$/);
      expect(persona.accountId).toBe(`${persona.id}-credential`);
      expect(persona.email).toMatch(/^[a-z]+\.[a-z]+@demo\.novedu\.invalid$/);
      expect(persona.name.startsWith(persona.givenName)).toBe(true);
    }
  });

  it("pin the public password literal the build-marker check looks for", () => {
    expect(DEMO_PASSWORD).toBe("novedu-demo-login-not-a-secret");
  });
});
