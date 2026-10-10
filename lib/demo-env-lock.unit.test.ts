import { describe, expect, it } from "vitest";
import { demoBootRefusal, ENTRA_ENV_NAMES } from "@/lib/demo-env-lock";

// A demo build signs anyone in as anyone, so it refuses to start where a real
// installation's settings are present (docs/auth.md, "Demo mode").

describe("demoBootRefusal", () => {
  it("lets a clean environment through", () => {
    expect(demoBootRefusal({})).toBeNull();
  });

  it.each(ENTRA_ENV_NAMES)("refuses a set %s", (name) => {
    expect(demoBootRefusal({ [name]: "x" })).toContain(name);
  });

  it("lets EMPTY Entra settings through (a blanked .env.local value)", () => {
    expect(demoBootRefusal(Object.fromEntries(ENTRA_ENV_NAMES.map((n) => [n, ""])))).toBeNull();
  });

  it.each([
    "https://novedu.at",
    "https://app.novedu.at/api/auth",
    "https://dev.novedu.at:8443",
    "https://APP.Novedu.AT",
    "https://app.novedu.at./api/auth",
    "http://a.b.novedu.at",
  ])("refuses AUTH_URL %s", (url) => {
    expect(demoBootRefusal({ AUTH_URL: url })).toMatch(/novedu\.at, a real Novedu installation/);
  });

  it.each([
    "http://localhost:3000",
    "https://novedu.at.example.com",
    "https://notnovedu.at",
    "https://demo.school.example/api/auth",
  ])("lets AUTH_URL %s through", (url) => {
    expect(demoBootRefusal({ AUTH_URL: url })).toBeNull();
  });

  it("fails closed on an AUTH_URL that does not parse", () => {
    expect(demoBootRefusal({ AUTH_URL: "app.novedu.at" })).toMatch(/not a valid URL/);
  });

  it("lets an unset or empty AUTH_URL through", () => {
    expect(demoBootRefusal({ AUTH_URL: undefined })).toBeNull();
    expect(demoBootRefusal({ AUTH_URL: "" })).toBeNull();
  });
});
