import { expect, test } from "vitest";
import { render } from "vitest-browser-react";
import { ErrorList, WarningList } from "@/components/validation-result";
import type { ValidationError, ValidationWarning } from "@/lib/prompt-fragments";

// Pure prop rendering of a broken tutor's structured errors/warnings. This is
// what a student saw via the @live e2e/tutor-chat.spec.ts (a valid code for a
// broken tutor → the error list, no chat); the list itself needs no DB. The
// loading/consistency that PRODUCES these is covered by lib/tutors/*.unit.test;
// here we pin both error codes plus the location string and the warning view.

const errors: ValidationError[] = [
  {
    code: "MISSING_REQUIRED_VARIABLE",
    message: "Required variable is not provided.",
    fileAlias: "general_fragments",
    fragmentId: "socratic_tutor",
    variable: "topic",
  },
  {
    code: "FRAGMENT_NOT_FOUND",
    message: 'Fragment "intro" not found in file "general_fragments".',
    fileAlias: "general_fragments",
    fragmentId: "intro",
  },
];

test("ErrorList shows every error code, message and location", async () => {
  const screen = await render(<ErrorList errors={errors} />);

  await expect
    .element(screen.getByRole("heading", { name: "Validation failed (2)" }))
    .toBeVisible();
  await expect.element(screen.getByText("MISSING_REQUIRED_VARIABLE")).toBeVisible();
  await expect.element(screen.getByText("FRAGMENT_NOT_FOUND")).toBeVisible();
  // locationOf: "<fileAlias> / <fragmentId> · <variable>".
  await expect
    .element(screen.getByText("general_fragments / socratic_tutor · topic"))
    .toBeVisible();
});

test("WarningList shows non-fatal warnings", async () => {
  const warnings: ValidationWarning[] = [
    { code: "UNDECLARED_VARIABLE", message: "Variable used but not declared.", variable: "tone" },
  ];
  const screen = await render(<WarningList warnings={warnings} />);

  await expect.element(screen.getByRole("heading", { name: "Warnings (1)" })).toBeVisible();
  await expect.element(screen.getByText("UNDECLARED_VARIABLE")).toBeVisible();
});
