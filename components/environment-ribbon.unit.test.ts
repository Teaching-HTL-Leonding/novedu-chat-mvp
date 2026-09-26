import { describe, expect, it } from "vitest";
import { environmentForHost } from "./environment-ribbon";

// The host → environment mapping behind the environment ribbon. Exact hostnames
// only: a look-alike host gets no ribbon rather than a wrong one.

describe("environmentForHost", () => {
  it.each([
    ["localhost", "local"],
    ["127.0.0.1", "local"],
    ["[::1]", "local"],
    ["dev.novedu.at", "dev"],
    ["app.novedu.at", "prod"],
    ["APP.Novedu.AT", "prod"],
  ])("maps %s to %s", (host, env) => {
    expect(environmentForHost(host)).toBe(env);
  });

  it.each([
    "",
    "novedu.at",
    "xdev.novedu.at",
    "app.novedu.at.evil.com",
    "ca-novedu-dev.example.azurecontainerapps.io",
  ])("shows no ribbon for %j", (host) => {
    expect(environmentForHost(host)).toBeNull();
  });
});
