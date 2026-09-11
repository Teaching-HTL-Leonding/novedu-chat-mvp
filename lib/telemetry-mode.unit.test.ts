// @vitest-environment node
import { describe, expect, it } from "vitest";
import { resolveTelemetryMode } from "@/lib/telemetry-mode";

// The selection contract from docs/telemetry.md, row by row. The resolver takes
// the environment as a plain object so no stubbing is needed.

const OTLP = "http://collector.internal:4318";
const AZURE = "InstrumentationKey=00000000-0000-0000-0000-000000000000;IngestionEndpoint=https://x";

describe("resolveTelemetryMode", () => {
  it("is disabled when nothing is configured", () => {
    const choice = resolveTelemetryMode({});
    expect(choice.mode).toBe("disabled");
    expect(choice.reason).toMatch(/neither/);
  });

  it("picks OTLP when only the OTLP endpoint is set", () => {
    expect(resolveTelemetryMode({ OTEL_EXPORTER_OTLP_ENDPOINT: OTLP }).mode).toBe("otlp");
  });

  it("picks Azure when only the connection string is set", () => {
    expect(resolveTelemetryMode({ APPLICATIONINSIGHTS_CONNECTION_STRING: AZURE }).mode).toBe(
      "azure",
    );
  });

  it("lets OTLP win when both destinations are present", () => {
    expect(
      resolveTelemetryMode({
        OTEL_EXPORTER_OTLP_ENDPOINT: OTLP,
        APPLICATIONINSIGHTS_CONNECTION_STRING: AZURE,
      }).mode,
    ).toBe("otlp");
  });

  it("OTEL_SDK_DISABLED=true disables everything regardless of destinations", () => {
    for (const flag of ["true", "TRUE", "True", "  true "]) {
      const choice = resolveTelemetryMode({
        OTEL_SDK_DISABLED: flag,
        OTEL_EXPORTER_OTLP_ENDPOINT: OTLP,
        APPLICATIONINSIGHTS_CONNECTION_STRING: AZURE,
      });
      expect(choice.mode, flag).toBe("disabled");
      expect(choice.reason).toBe("OTEL_SDK_DISABLED=true");
    }
  });

  it("any other OTEL_SDK_DISABLED value does not disable", () => {
    for (const flag of ["false", "1", "yes", "", "  "]) {
      expect(
        resolveTelemetryMode({ OTEL_SDK_DISABLED: flag, OTEL_EXPORTER_OTLP_ENDPOINT: OTLP }).mode,
        JSON.stringify(flag),
      ).toBe("otlp");
    }
  });

  it("treats whitespace-only values as absent", () => {
    expect(resolveTelemetryMode({ OTEL_EXPORTER_OTLP_ENDPOINT: "   " }).mode).toBe("disabled");
    expect(resolveTelemetryMode({ APPLICATIONINSIGHTS_CONNECTION_STRING: "\t" }).mode).toBe(
      "disabled",
    );
    expect(
      resolveTelemetryMode({
        OTEL_EXPORTER_OTLP_ENDPOINT: " ",
        APPLICATIONINSIGHTS_CONNECTION_STRING: AZURE,
      }).mode,
    ).toBe("azure");
  });

  it("per-signal endpoint variables alone do not enable the OTLP path", () => {
    expect(
      resolveTelemetryMode({
        OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: `${OTLP}/v1/traces`,
        OTEL_EXPORTER_OTLP_METRICS_ENDPOINT: `${OTLP}/v1/metrics`,
        OTEL_EXPORTER_OTLP_LOGS_ENDPOINT: `${OTLP}/v1/logs`,
      }).mode,
    ).toBe("disabled");
  });

  it("never echoes a configured value in the reason", () => {
    for (const env of [
      { OTEL_EXPORTER_OTLP_ENDPOINT: OTLP },
      { APPLICATIONINSIGHTS_CONNECTION_STRING: AZURE },
      { OTEL_EXPORTER_OTLP_ENDPOINT: OTLP, APPLICATIONINSIGHTS_CONNECTION_STRING: AZURE },
    ]) {
      const { reason } = resolveTelemetryMode(env);
      expect(reason).not.toContain(OTLP);
      expect(reason).not.toContain("InstrumentationKey");
    }
  });
});
