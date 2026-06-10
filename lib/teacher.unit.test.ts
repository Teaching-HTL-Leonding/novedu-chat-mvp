import type { Profile } from "next-auth";
import { describe, expect, it } from "vitest";
import { resolveTeacher } from "./teacher";

const TEACHER_GROUP = "1adac4e1-be54-458c-90ef-318d89f83317";

describe("resolveTeacher", () => {
  it("returns isTeacher when the groups claim contains the teacher group", () => {
    const profile = { groups: ["abc", TEACHER_GROUP, "def"] } as unknown as Profile;
    expect(resolveTeacher(profile, TEACHER_GROUP)).toEqual({ isTeacher: true, overage: false });
  });

  it("returns not-a-teacher when the groups claim omits the teacher group", () => {
    const profile = { groups: ["abc", "def"] } as unknown as Profile;
    expect(resolveTeacher(profile, TEACHER_GROUP)).toEqual({ isTeacher: false, overage: false });
  });

  it("returns not-a-teacher when there is no groups claim", () => {
    const profile = { name: "Someone" } as unknown as Profile;
    expect(resolveTeacher(profile, TEACHER_GROUP)).toEqual({ isTeacher: false, overage: false });
  });

  it("flags overage and fails closed when Entra omits the array", () => {
    const profile = {
      _claim_names: { groups: "src1" },
      _claim_sources: { src1: { endpoint: "https://graph.microsoft.com/..." } },
    } as unknown as Profile;
    expect(resolveTeacher(profile, TEACHER_GROUP)).toEqual({ isTeacher: false, overage: true });
  });

  it("handles a missing profile", () => {
    expect(resolveTeacher(undefined, TEACHER_GROUP)).toEqual({ isTeacher: false, overage: false });
  });
});
