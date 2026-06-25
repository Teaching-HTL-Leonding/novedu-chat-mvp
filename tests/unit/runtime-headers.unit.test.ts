import { describe, expect, it } from "vitest";
import { buildRuntimeHeaders } from "@/lib/runtime-headers";

describe("buildRuntimeHeaders", () => {
  it("builds the exact header names the backend route re-reads", () => {
    // The literal names are load-bearing: the runtime route reads "x-code" and
    // "x-thread-token" verbatim, so a rename here would silently break auth.
    expect(buildRuntimeHeaders("abc", "tok")).toEqual({
      "x-code": "abc",
      "x-thread-token": "tok",
    });
  });
});
