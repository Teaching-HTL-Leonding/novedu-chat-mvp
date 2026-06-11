import { randomInt } from "node:crypto";
import { odata, TableClient } from "@azure/data-tables";
import { buildDataStoreCredential } from "@/lib/azure-credential";

// Persistence for tutor share links in Azure Table Storage: every link a teacher
// creates is stored under their user id (partition key) with a short random code
// (row key), so the chat can also be opened through `/?link=<code>` instead of the
// full signed deep link. The table is a convenience index — the HMAC signature in
// the stored payload remains the actual security boundary; a resolved code still
// goes through `verifyShareLink`.
//
// Storage is OPTIONAL: when `AZURE_STORAGE_ACCOUNT_NAME` is unset or unreachable,
// callers degrade to full-link-only behavior (see storeShareLink/resolveShortCode
// result types — neither ever throws).
//
// SERVER-ONLY: uses node:crypto and Azure credentials. Never import from client
// components.

const TABLE_NAME = "novedusharedlinks";

/** Row-key format of stored links: 10 random lowercase letters/digits. */
export const SHORT_CODE_PATTERN = /^[a-z0-9]{10}$/;

const SHORT_CODE_ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";
const SHORT_CODE_LENGTH = 10;

/** Crypto-secure random short code (`randomInt` is uniform — no modulo bias). */
export function generateShortCode(): string {
  let code = "";
  for (let i = 0; i < SHORT_CODE_LENGTH; i++) {
    code += SHORT_CODE_ALPHABET[randomInt(SHORT_CODE_ALPHABET.length)];
  }
  return code;
}

/** The pieces of a share link, as stored in (and read back from) the table. */
export interface StoredShareLink {
  /** Public URL of the tutor-definition YAML (normalized, as signed). */
  tutor: string;
  /** Window start, unix seconds (UTC). */
  start: number;
  /** Window end, unix seconds (UTC). */
  end: number;
  /** HMAC signature over tutor/start/end — re-verified when the code is resolved. */
  sig: string;
  /**
   * Origin the link was created on, e.g. `http://localhost:3000`. FOR THE
   * OPERATOR'S EYES ONLY — it tells DEV from PROD rows in the table browser.
   * Resolution never reads it: a short code works on ANY origin (created on
   * localhost, opened in prod). Optional so rows without it still resolve.
   */
  origin?: string;
}

interface ShareLinkEntity extends StoredShareLink {
  partitionKey: string;
  rowKey: string;
}

export function toShareLinkEntity(
  userId: string,
  code: string,
  link: StoredShareLink,
): ShareLinkEntity {
  return { partitionKey: userId, rowKey: code, ...link };
}

/** Maps a table row back to a link; `undefined` for malformed/foreign rows. */
export function fromShareLinkEntity(entity: Record<string, unknown>): StoredShareLink | undefined {
  const { tutor, start, end, sig, origin } = entity;
  if (
    typeof tutor !== "string" ||
    typeof sig !== "string" ||
    typeof start !== "number" ||
    typeof end !== "number" ||
    !Number.isFinite(start) ||
    !Number.isFinite(end)
  ) {
    return undefined;
  }
  // `origin` is deliberately NOT required: it is operator documentation, and
  // resolution must keep working for rows that lack it.
  return { tutor, start, end, sig, ...(typeof origin === "string" ? { origin } : {}) };
}

// Strict `end < now`: at `end === now` the link is still inside its window
// (verifyShareLink's bounds are inclusive), so it must survive garbage collection.
export function isExpiredEntity(entity: { end: number }, nowSeconds: number): boolean {
  return entity.end < nowSeconds;
}

// Table partition/row keys forbid `/ \ # ?` and control characters. The Entra
// `sub` we use as user id is base64url-shaped ([A-Za-z0-9_-]), so it is always
// safe — but guard anyway and let callers degrade instead of throwing mid-write.
export function isSafePartitionKey(userId: string): boolean {
  return /^[A-Za-z0-9_-]+$/.test(userId);
}

// Entra-only auth (shared-key access is disabled on the account) via the shared
// data-store credential chain — see lib/azure-credential.ts for why it is built
// explicitly instead of DefaultAzureCredential.
function buildTableClient(accountName: string): TableClient {
  return new TableClient(
    `https://${accountName}.table.core.windows.net`,
    TABLE_NAME,
    buildDataStoreCredential(),
  );
}

// Reuse one client across Next.js HMR reloads in dev — its credential caches the
// Entra token, and a fresh AzureCliCredential would shell out to `az` again on
// every request. Keyed by account name so an env change in tests rebuilds it.
// `tableReady` remembers that the table exists, so only the first write of a
// process pays the extra createTable round trip.
const globalForTable = globalThis as unknown as {
  shareLinkTableClient?: { accountName: string; client: TableClient; tableReady: boolean };
};

function getTableEntry(): { client: TableClient; tableReady: boolean } | undefined {
  const accountName = process.env.AZURE_STORAGE_ACCOUNT_NAME;
  if (!accountName) return undefined;
  if (globalForTable.shareLinkTableClient?.accountName !== accountName) {
    globalForTable.shareLinkTableClient = {
      accountName,
      client: buildTableClient(accountName),
      tableReady: false,
    };
  }
  return globalForTable.shareLinkTableClient;
}

export type StoreShareLinkResult = { stored: true; code: string } | { stored: false };

// A createEntity conflict (the partition+row key already exists) surfaces as a
// RestError with HTTP 409 — the signal to retry with a fresh random code.
function isEntityAlreadyExists(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "statusCode" in error &&
    (error as { statusCode?: unknown }).statusCode === 409
  );
}

// With a 36^10 keyspace two consecutive collisions are practically impossible;
// the cap only guards against a systematic 409 (e.g. a misbehaving emulator)
// turning into an infinite loop.
const MAX_CODE_ATTEMPTS = 10;

/**
 * Stores a freshly created link under the creating user's partition. Never
 * throws: storage being unavailable means `{ stored: false }` — the caller
 * still has the full signed link to hand out. Cleanup of the user's expired
 * links is NOT done here — the caller schedules `gcExpiredShareLinks` off the
 * response path.
 */
export async function storeShareLink(
  userId: string,
  link: StoredShareLink,
): Promise<StoreShareLinkResult> {
  const entry = getTableEntry();
  if (!entry) return { stored: false };
  const { client } = entry;
  if (!isSafePartitionKey(userId)) {
    console.error(`share-link-store: user id is not a valid partition key, link not stored`);
    return { stored: false };
  }

  // Create the table before the first write (idempotent — the SDK swallows
  // TableAlreadyExists), so a fresh storage account needs no manual
  // provisioning. Reads don't need this: a missing table simply resolves no
  // codes.
  if (!entry.tableReady) {
    try {
      await client.createTable();
      entry.tableReady = true;
    } catch (error) {
      console.error("share-link-store: creating the share-link table failed", error);
      return { stored: false };
    }
  }

  let code: string | undefined;
  for (let attempt = 0; attempt < MAX_CODE_ATTEMPTS && code === undefined; attempt++) {
    const candidate = generateShortCode();
    try {
      await client.createEntity(toShareLinkEntity(userId, candidate, link));
      code = candidate;
    } catch (error) {
      if (isEntityAlreadyExists(error)) continue; // code taken — retry with a new one
      console.error("share-link-store: failed to store share link", error);
      return { stored: false };
    }
  }
  if (code === undefined) {
    console.error("share-link-store: could not find a free short code, link not stored");
    return { stored: false };
  }

  return { stored: true, code };
}

/**
 * Garbage-collects a user's expired links (window over: `end < now` — at
 * `end === now` a link is still valid, see isExpiredEntity). Housekeeping whose
 * result no caller consumes: the create action schedules it via next/server's
 * `after()` so it runs AFTER the teacher's form response is sent. Never throws —
 * failures only log, and the next run picks up whatever was left behind.
 */
export async function gcExpiredShareLinks(
  userId: string,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): Promise<void> {
  const client = getTableEntry()?.client;
  if (!client) return;
  try {
    const expired = client.listEntities<ShareLinkEntity>({
      queryOptions: {
        filter: odata`PartitionKey eq ${userId} and end lt ${nowSeconds}`,
        select: ["partitionKey", "rowKey"],
      },
    });
    for await (const entity of expired) {
      await client.deleteEntity(entity.partitionKey, entity.rowKey);
    }
  } catch (error) {
    console.error("share-link-store: garbage collection of expired links failed", error);
  }
}

export type ResolveShortCodeResult =
  | { ok: true; link: StoredShareLink }
  // No row with this code — never issued, or already garbage-collected.
  | { ok: false; reason: "unknown-code" }
  // Storage misconfigured/unreachable — the full link still works.
  | { ok: false; reason: "lookup-failed" };

/**
 * Looks a short code up across ALL partitions: the code is opened by a student,
 * so the creating teacher's user id (= partition key) is unknown. That makes
 * this a table scan by design — fine at this scale, since GC keeps the table
 * small. Malformed codes are rejected without a storage round-trip.
 */
export async function resolveShortCode(code: string): Promise<ResolveShortCodeResult> {
  if (!SHORT_CODE_PATTERN.test(code)) return { ok: false, reason: "unknown-code" };
  const client = getTableEntry()?.client;
  if (!client) return { ok: false, reason: "lookup-failed" };

  try {
    // Untyped on purpose: rows are untrusted input, fromShareLinkEntity validates.
    const matches = client.listEntities({
      queryOptions: { filter: odata`RowKey eq ${code}` },
    });
    for await (const entity of matches) {
      const link = fromShareLinkEntity(entity);
      return link ? { ok: true, link } : { ok: false, reason: "unknown-code" };
    }
    return { ok: false, reason: "unknown-code" };
  } catch (error) {
    console.error("share-link-store: short-code lookup failed", error);
    return { ok: false, reason: "lookup-failed" };
  }
}

/**
 * Which kind of share parameters a chat-page request carries. The full signed
 * parameter set wins over a short code (it needs no storage round-trip);
 * `tutor` + `sig` present is "full" — verifyShareLink reports exactly what is
 * wrong with an incomplete rest.
 */
export function selectShareSource(params: {
  tutor?: string;
  sig?: string;
  link?: string;
}): "full" | "code" | "none" {
  if (params.tutor && params.sig) return "full";
  if (params.link) return "code";
  return "none";
}
