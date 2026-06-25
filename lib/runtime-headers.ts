// The runtime header pair every live-chat surface sends to /api/copilotkit on
// each request. The code identifies the activity; the thread-ownership token
// binds the session to one Mastra thread. Both are re-verified server-side on
// every runtime touch (see docs/codes.md) — the client is never trusted.
//
// This module is pure and client-safe (no server-only imports): it only names
// the two headers and builds the object the CopilotKitProvider `headers` prop
// expects. The backend route imports these same constants to read the headers,
// so the names have one source of truth across the client/server seam.
export const RUNTIME_CODE_HEADER = "x-code";
export const RUNTIME_THREAD_TOKEN_HEADER = "x-thread-token";

export type RuntimeHeaders = {
  [RUNTIME_CODE_HEADER]: string;
  [RUNTIME_THREAD_TOKEN_HEADER]: string;
};

export function buildRuntimeHeaders(code: string, threadToken: string): RuntimeHeaders {
  return { [RUNTIME_CODE_HEADER]: code, [RUNTIME_THREAD_TOKEN_HEADER]: threadToken };
}
