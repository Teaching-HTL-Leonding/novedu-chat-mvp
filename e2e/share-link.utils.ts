import { loadEnvConfig } from "@next/env";
import {
  buildShareLink,
  getShareLinkSecret,
  type SharePayload,
  signSharePayload,
} from "../lib/share-links";

// Builds share links with the SAME secret and signing code the dev server uses,
// so e2e specs can mint valid (or deliberately broken) deep links without
// driving the Share Tutor UI each time. Stable sample tutors live on `main` of
// the public repo precisely so these URLs stay valid.

export const RAW_TUTORS =
  "https://raw.githubusercontent.com/Teaching-HTL-Leonding/novedu-chat-mvp/refs/heads/main/tutors";
export const VALID_TUTOR_URL = `${RAW_TUTORS}/simple-tutor.yaml`;
export const BROKEN_TUTOR_URL = `${RAW_TUTORS}/broken-tutor.yaml`;

export function shareLinkSecret(): string {
  // Load `.env` exactly as Next does, then reuse the app's own accessor so the
  // env-var name and error semantics can never drift from the server's.
  loadEnvConfig(process.cwd());
  return getShareLinkSecret();
}

/** A signed deep link to the local dev server's chat. */
export function makeShareLink(payload: SharePayload): string {
  const sig = signSharePayload(payload, shareLinkSecret());
  return buildShareLink("http://localhost:3000/", payload, sig);
}

/** A share payload whose window comfortably contains "now". */
export function openWindow(tutor: string): SharePayload {
  const now = Math.floor(Date.now() / 1000);
  return { tutor, start: now - 3600, end: now + 3600 };
}
