// @vitest-environment node
import { createServer, get, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { closedPort } from "../tests/otlp-receiver";

// Telemetry is best effort: a receiver that refuses connections must not stop
// startup, the facade's helpers, or ordinary HTTP traffic. Own file: it starts
// the real NodeSDK through the facade (see the delivery test for why).

const unhandled: unknown[] = [];
const onUnhandled = (reason: unknown) => unhandled.push(reason);
let mode: string;
let appServer: Server;

beforeAll(async () => {
  process.on("unhandledRejection", onUnhandled);
  vi.stubEnv("OTEL_EXPORTER_OTLP_ENDPOINT", `http://127.0.0.1:${await closedPort()}`);
  vi.stubEnv("OTEL_EXPORTER_OTLP_PROTOCOL", "http/json");
  // Short schedules so the failing exports actually happen inside the test.
  vi.stubEnv("OTEL_BSP_SCHEDULE_DELAY", "50");
  vi.stubEnv("OTEL_BLRP_SCHEDULE_DELAY", "50");
  vi.stubEnv("OTEL_METRIC_EXPORT_INTERVAL", "100");
  vi.stubEnv("OTEL_METRIC_EXPORT_TIMEOUT", "50");
  vi.stubEnv("OTEL_LOG_LEVEL", "");
  vi.resetModules();
  const { initTelemetry, emitEvent, recordError } = await import("@/lib/telemetry");
  mode = await initTelemetry();
  emitEvent("probe_event");
  recordError(new Error("probe failure"));

  appServer = createServer((_req, res) => {
    res.writeHead(200);
    res.end("ok");
  });
  await new Promise<void>((resolve) => appServer.listen(0, "127.0.0.1", resolve));
  await new Promise((resolve) => setTimeout(resolve, 400));
}, 30_000);

afterAll(async () => {
  process.off("unhandledRejection", onUnhandled);
  await new Promise<void>((resolve) => appServer.close(() => resolve()));
  vi.unstubAllEnvs();
});

describe("OTLP path with a refusing receiver", () => {
  it("still selects and starts the OTLP backend", () => {
    expect(mode).toBe("otlp");
  });

  it("serves ordinary HTTP traffic while exports fail", async () => {
    const { port } = appServer.address() as AddressInfo;
    const status = await new Promise<number>((resolve, reject) => {
      get(`http://127.0.0.1:${port}/`, (res) => {
        res.resume();
        res.on("end", () => resolve(res.statusCode ?? 0));
      }).on("error", reject);
    });
    expect(status).toBe(200);
  });

  it("raises no unhandled rejection from the failed exports", async () => {
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(unhandled).toEqual([]);
  });
});
