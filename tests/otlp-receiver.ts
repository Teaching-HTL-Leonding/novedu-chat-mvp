import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

// An in-process OTLP/HTTP receiver for the telemetry tests: accepts the JSON
// encoding (OTEL_EXPORTER_OTLP_PROTOCOL=http/json needs no protobuf decoding and
// exercises the same SDK path) on /v1/{traces,metrics,logs} and keeps every
// parsed body so tests can assert on what actually left the SDK. Never used by
// the app; a test double only.

export type OtlpRequest = { path: string; body: Record<string, unknown> };

export type OtlpReceiver = {
  url: string;
  requests: OtlpRequest[];
  close(): Promise<void>;
};

export async function startOtlpReceiver(): Promise<OtlpReceiver> {
  const requests: OtlpRequest[] = [];
  const server: Server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      let body: Record<string, unknown> = {};
      try {
        body = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
      } catch {
        body = { unparsable: raw.slice(0, 200) };
      }
      requests.push({ path: req.url ?? "", body });
      res.writeHead(200, { "content-type": "application/json" });
      res.end("{}");
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    requests,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

/** A loopback port nothing listens on (bound, then released). */
export async function closedPort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}

type KeyValue = { key: string; value: Record<string, unknown> };

/** Flattens an OTLP attribute list into a plain object of stringified values. */
export function attributesOf(list: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  for (const { key, value } of (list as KeyValue[] | undefined) ?? []) {
    out[key] = JSON.stringify(value);
  }
  return out;
}

type Resourceful = { resource?: { attributes?: unknown } };

/** Every resource attribute map seen across all requests, per signal payload. */
export function resourcesOf(requests: OtlpRequest[]): Record<string, string>[] {
  const out: Record<string, string>[] = [];
  for (const { body } of requests) {
    for (const key of ["resourceSpans", "resourceLogs", "resourceMetrics"]) {
      for (const entry of (body[key] as Resourceful[] | undefined) ?? []) {
        out.push(attributesOf(entry.resource?.attributes));
      }
    }
  }
  return out;
}

export type ExportedSpan = { name: string; attributes: Record<string, string>; status?: unknown };

export function spansOf(requests: OtlpRequest[]): ExportedSpan[] {
  const out: ExportedSpan[] = [];
  for (const { body } of requests) {
    for (const rs of (body.resourceSpans as Array<{ scopeSpans?: unknown[] }> | undefined) ?? []) {
      for (const ss of (rs.scopeSpans as Array<{ spans?: unknown[] }> | undefined) ?? []) {
        for (const span of (ss.spans as Array<Record<string, unknown>> | undefined) ?? []) {
          out.push({
            name: String(span.name),
            attributes: attributesOf(span.attributes),
            status: span.status,
          });
        }
      }
    }
  }
  return out;
}

export type ExportedLog = {
  body: unknown;
  eventName?: string;
  attributes: Record<string, string>;
};

export function logsOf(requests: OtlpRequest[]): ExportedLog[] {
  const out: ExportedLog[] = [];
  for (const { body } of requests) {
    for (const rl of (body.resourceLogs as Array<{ scopeLogs?: unknown[] }> | undefined) ?? []) {
      for (const sl of (rl.scopeLogs as Array<{ logRecords?: unknown[] }> | undefined) ?? []) {
        for (const record of (sl.logRecords as Array<Record<string, unknown>> | undefined) ?? []) {
          out.push({
            body: record.body,
            eventName: record.eventName as string | undefined,
            attributes: attributesOf(record.attributes),
          });
        }
      }
    }
  }
  return out;
}

export function metricNamesOf(requests: OtlpRequest[]): string[] {
  const out: string[] = [];
  for (const { body } of requests) {
    for (const rm of (body.resourceMetrics as Array<{ scopeMetrics?: unknown[] }> | undefined) ??
      []) {
      for (const sm of (rm.scopeMetrics as Array<{ metrics?: unknown[] }> | undefined) ?? []) {
        for (const metric of (sm.metrics as Array<{ name: string }> | undefined) ?? []) {
          out.push(metric.name);
        }
      }
    }
  }
  return out;
}
