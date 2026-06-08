import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ErrorList, locationOf, WarningList } from "./result-views";

describe("locationOf", () => {
  it("joins file alias and fragment id", () => {
    expect(locationOf({ fileAlias: "general", fragmentId: "socratic_tutor" })).toBe(
      "general / socratic_tutor",
    );
  });

  it("appends the variable with a separator", () => {
    expect(
      locationOf({ fileAlias: "general", fragmentId: "socratic_tutor", variable: "domain" }),
    ).toBe("general / socratic_tutor · domain");
  });

  it("returns just the variable when nothing else is present", () => {
    expect(locationOf({ variable: "domain" })).toBe("domain");
  });

  it("returns null when there is nothing to locate", () => {
    expect(locationOf({})).toBeNull();
  });
});

describe("ErrorList", () => {
  it("renders the count, each code, message, and location", () => {
    render(
      <ErrorList
        errors={[
          {
            code: "MISSING_REQUIRED_VARIABLE",
            message: "Fragment socratic_tutor requires variable domain",
            fileAlias: "general",
            fragmentId: "socratic_tutor",
            variable: "domain",
          },
          { code: "DUPLICATE_PRIORITY", message: "Priority 100 is shared" },
        ]}
      />,
    );

    expect(screen.getByText("Validation failed (2)")).toBeInTheDocument();
    expect(screen.getByText("MISSING_REQUIRED_VARIABLE")).toBeInTheDocument();
    expect(
      screen.getByText("Fragment socratic_tutor requires variable domain"),
    ).toBeInTheDocument();
    expect(screen.getByText("general / socratic_tutor · domain")).toBeInTheDocument();
    expect(screen.getByText("DUPLICATE_PRIORITY")).toBeInTheDocument();
  });
});

describe("WarningList", () => {
  it("renders warning code and message", () => {
    render(
      <WarningList
        warnings={[
          {
            code: "UNDECLARED_VARIABLE",
            message: "Variable surprise is not declared",
            fragmentId: "socratic_tutor",
            variable: "surprise",
          },
        ]}
      />,
    );

    expect(screen.getByText("Warnings (1)")).toBeInTheDocument();
    expect(screen.getByText("UNDECLARED_VARIABLE")).toBeInTheDocument();
    expect(screen.getByText("Variable surprise is not declared")).toBeInTheDocument();
  });
});
