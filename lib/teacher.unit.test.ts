import { describe, expect, it } from "vitest";
import { decodeJwtPayload, resolveTeacher, teacherFromIdToken } from "./teacher";

const TEACHER_GROUP = "1adac4e1-be54-458c-90ef-318d89f83317";

/** A signature-free JWT shape: only the payload segment is ever read. */
function idToken(payload: Record<string, unknown>): string {
  const body = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  return `header.${body}.signature`;
}

describe("resolveTeacher", () => {
  it("returns isTeacher when the groups claim contains the teacher group", () => {
    const claims = { groups: ["abc", TEACHER_GROUP, "def"] };
    expect(resolveTeacher(claims, TEACHER_GROUP)).toEqual({ isTeacher: true, overage: false });
  });

  it("returns not-a-teacher when the groups claim omits the teacher group", () => {
    const claims = { groups: ["abc", "def"] };
    expect(resolveTeacher(claims, TEACHER_GROUP)).toEqual({ isTeacher: false, overage: false });
  });

  it("returns not-a-teacher when there is no groups claim", () => {
    expect(resolveTeacher({ name: "Someone" }, TEACHER_GROUP)).toEqual({
      isTeacher: false,
      overage: false,
    });
  });

  it("flags overage and fails closed when Entra omits the array", () => {
    const claims = {
      _claim_names: { groups: "src1" },
      _claim_sources: { src1: { endpoint: "https://graph.microsoft.com/..." } },
    };
    expect(resolveTeacher(claims, TEACHER_GROUP)).toEqual({ isTeacher: false, overage: true });
  });

  it("handles missing claims", () => {
    expect(resolveTeacher(undefined, TEACHER_GROUP)).toEqual({ isTeacher: false, overage: false });
  });
});

describe("decodeJwtPayload", () => {
  it("decodes the payload segment of a well-formed token", () => {
    expect(decodeJwtPayload(idToken({ oid: "abc", groups: ["g1"] }))).toEqual({
      oid: "abc",
      groups: ["g1"],
    });
  });

  it("decodes base64url payloads containing - and _ (and no padding)", () => {
    // `??~` encodes to "Pz9-" / "P_8" style output — base64url-only characters.
    const payload = { name: "Ünïcøde ?>?", groups: [] };
    expect(decodeJwtPayload(idToken(payload))).toEqual(payload);
  });

  it("returns null for a string that is not a JWT", () => {
    expect(decodeJwtPayload("not-a-token")).toBeNull();
  });

  it("returns null when the payload segment is not valid JSON", () => {
    expect(decodeJwtPayload("header.bm90LWpzb24.signature")).toBeNull();
  });

  it("returns null when the payload is a JSON array or scalar", () => {
    const array = Buffer.from("[1,2]", "utf8").toString("base64url");
    const scalar = Buffer.from('"hi"', "utf8").toString("base64url");
    expect(decodeJwtPayload(`h.${array}.s`)).toBeNull();
    expect(decodeJwtPayload(`h.${scalar}.s`)).toBeNull();
  });

  it("returns null for an empty string", () => {
    expect(decodeJwtPayload("")).toBeNull();
  });
});

describe("teacherFromIdToken", () => {
  it("reads the teacher group out of the token", () => {
    expect(teacherFromIdToken(idToken({ groups: [TEACHER_GROUP] }), TEACHER_GROUP)).toEqual({
      isTeacher: true,
      overage: false,
    });
  });

  it("is not a teacher when the token's groups omit it", () => {
    expect(teacherFromIdToken(idToken({ groups: ["other"] }), TEACHER_GROUP)).toEqual({
      isTeacher: false,
      overage: false,
    });
  });

  it("is not a teacher when the token carries no groups claim", () => {
    expect(teacherFromIdToken(idToken({ oid: "abc" }), TEACHER_GROUP)).toEqual({
      isTeacher: false,
      overage: false,
    });
  });

  it("flags overage from the token's claim-source pointers", () => {
    const token = idToken({ _claim_names: { groups: "src1" }, _claim_sources: { src1: {} } });
    expect(teacherFromIdToken(token, TEACHER_GROUP)).toEqual({ isTeacher: false, overage: true });
  });

  it("fails closed on a malformed token", () => {
    expect(teacherFromIdToken("garbage", TEACHER_GROUP)).toEqual({
      isTeacher: false,
      overage: false,
    });
  });
});
