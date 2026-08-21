// @vitest-environment node

import type { Session } from "next-auth";
import { beforeEach, describe, expect, it, vi } from "vitest";

// `lib/student-mode.ts` holds THE teacher rule — "real teacher AND not
// simulating a student" — that every teacher gate in the app derives from
// (AGENTS.md). It has exactly two I/O seams: the session (`@/auth`) and the
// student-mode cookie (`next/headers`); both are stubbed here so the rule itself
// runs for real.

const auth = vi.hoisted(() => vi.fn());
const requireTeacher = vi.hoisted(() => vi.fn());
const cookies = vi.hoisted(() => vi.fn());

vi.mock("@/auth", () => ({ auth, requireTeacher }));
vi.mock("next/headers", () => ({ cookies }));

import { studentModeCookies } from "@/tests/mocks/student-mode-cookies";
import {
  effectiveTeacherForSession,
  getTeacherView,
  isEffectiveTeacher,
  isStudentMode,
  requireEffectiveTeacher,
  requireTeacherUserId,
  teacherViewForSession,
} from "./student-mode";

const TEACHER = { user: { id: "u1", isTeacher: true } } as unknown as Session;
const STUDENT = { user: { id: "u2", isTeacher: false } } as unknown as Session;

function setStudentMode(active: boolean) {
  cookies.mockResolvedValue(studentModeCookies(active));
}

beforeEach(() => {
  vi.clearAllMocks();
  setStudentMode(false);
});

describe("isStudentMode", () => {
  it("is true only for the exact cookie value the mode writes", async () => {
    setStudentMode(true);
    await expect(isStudentMode()).resolves.toBe(true);
    cookies.mockResolvedValue(studentModeCookies(true, "yes"));
    await expect(isStudentMode()).resolves.toBe(false);
  });
});

describe("teacherViewForSession (the one definition of the rule)", () => {
  it("reports the triple for a real teacher who is NOT simulating", async () => {
    await expect(teacherViewForSession(TEACHER)).resolves.toEqual({
      realTeacher: true,
      studentMode: false,
      effectiveTeacher: true,
    });
  });

  it("reports real-but-not-effective while student mode is active", async () => {
    setStudentMode(true);
    await expect(teacherViewForSession(TEACHER)).resolves.toEqual({
      realTeacher: true,
      studentMode: true,
      effectiveTeacher: false,
    });
  });

  it("never reports studentMode for a non-teacher who set the cookie", async () => {
    setStudentMode(true);
    await expect(teacherViewForSession(STUDENT)).resolves.toEqual({
      realTeacher: false,
      studentMode: false,
      effectiveTeacher: false,
    });
  });
});

describe("effectiveTeacherForSession (the rule's boolean half)", () => {
  it("is true for a real teacher who is NOT simulating a student", async () => {
    await expect(effectiveTeacherForSession(TEACHER)).resolves.toBe(true);
  });

  it("is false for a real teacher WHILE student mode is active", async () => {
    setStudentMode(true);
    await expect(effectiveTeacherForSession(TEACHER)).resolves.toBe(false);
  });

  it("is false for a non-teacher, cookie or not (the cookie only restricts)", async () => {
    await expect(effectiveTeacherForSession(STUDENT)).resolves.toBe(false);
    setStudentMode(true);
    await expect(effectiveTeacherForSession(STUDENT)).resolves.toBe(false);
  });

  it("is false for no session at all", async () => {
    await expect(effectiveTeacherForSession(null)).resolves.toBe(false);
  });

  it("does NOT call auth() — it uses the session the caller already has", async () => {
    await effectiveTeacherForSession(TEACHER);
    expect(auth).not.toHaveBeenCalled();
  });
});

describe("getTeacherView (the same rule, over the session it fetches itself)", () => {
  it("reports a plain teacher as effective", async () => {
    auth.mockResolvedValue(TEACHER);
    await expect(getTeacherView()).resolves.toEqual({
      realTeacher: true,
      studentMode: false,
      effectiveTeacher: true,
    });
  });

  it("reports a simulating teacher as real-but-not-effective", async () => {
    auth.mockResolvedValue(TEACHER);
    setStudentMode(true);
    await expect(getTeacherView()).resolves.toEqual({
      realTeacher: true,
      studentMode: true,
      effectiveTeacher: false,
    });
  });

  it("never reports studentMode for a non-teacher who set the cookie", async () => {
    auth.mockResolvedValue(STUDENT);
    setStudentMode(true);
    await expect(getTeacherView()).resolves.toEqual({
      realTeacher: false,
      studentMode: false,
      effectiveTeacher: false,
    });
  });

  it("treats a missing session as a non-teacher", async () => {
    auth.mockResolvedValue(null);
    await expect(getTeacherView()).resolves.toMatchObject({ effectiveTeacher: false });
  });
});

describe("the shorthands still gate on the effective status", () => {
  it("isEffectiveTeacher follows getTeacherView", async () => {
    auth.mockResolvedValue(TEACHER);
    await expect(isEffectiveTeacher()).resolves.toBe(true);
    setStudentMode(true);
    await expect(isEffectiveTeacher()).resolves.toBe(false);
  });

  it("requireEffectiveTeacher refuses while student mode is active", async () => {
    requireTeacher.mockResolvedValue(TEACHER);
    await expect(requireEffectiveTeacher()).resolves.toBe(TEACHER);
    setStudentMode(true);
    await expect(requireEffectiveTeacher()).rejects.toThrow(/student mode/i);
  });

  it("requireTeacherUserId returns the oid, or a typed refusal", async () => {
    requireTeacher.mockResolvedValue(TEACHER);
    await expect(requireTeacherUserId()).resolves.toEqual({ ok: true, userId: "u1" });

    setStudentMode(true);
    await expect(requireTeacherUserId()).resolves.toEqual({ ok: false, reason: "not-teacher" });

    setStudentMode(false);
    requireTeacher.mockResolvedValue({ user: { isTeacher: true } } as unknown as Session);
    await expect(requireTeacherUserId()).resolves.toEqual({ ok: false, reason: "no-user-id" });
  });
});
