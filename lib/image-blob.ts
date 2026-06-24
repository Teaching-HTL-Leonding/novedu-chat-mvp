import {
  BlobSASPermissions,
  BlobServiceClient,
  generateBlobSASQueryParameters,
  RestError,
  SASProtocol,
  type UserDelegationKey,
} from "@azure/storage-blob";
import { buildDataStoreCredential } from "@/lib/azure-credential";
import type { ImageMime } from "@/lib/file-name";

// The ONE place this app talks to Azure Blob Storage — minting User-Delegation
// SAS URLs for direct browser uploads/reads, and inspecting/deleting blobs.
//
// Authentication is PASSWORDLESS only: the same data-store credential chain the
// SQL pools use (`buildDataStoreCredential()`), turned into a *user-delegation
// key* via `getUserDelegationKey`. Account keys are disabled on the storage
// account, so SAS is always signed from that delegation key — never a shared
// account key. Signing itself is local once the key is cached; only fetching the
// key hits the network.
//
// SERVER-ONLY: builds Azure credentials and reaches the storage account. Never
// import from client components.

const ACCOUNT = process.env.IMAGE_STORAGE_ACCOUNT ?? "stnoveduchatmvp";
const CONTAINER = process.env.IMAGE_BLOB_CONTAINER ?? "novedu-images";

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;

// Clock-skew cushion: SAS (and the delegation key) start slightly in the past so
// a fast client whose clock runs ahead of Azure's still validates.
const SKEW_MS = 5 * MINUTE_MS;
// Delegation-key lifetime and the margin at which we proactively re-fetch. Azure
// caps a user-delegation key at 7 days; we ask for ~6h and renew once we are
// within ~30min of expiry, so signing is almost always a local, network-free op.
const KEY_LIFETIME_MS = 6 * HOUR_MS;
const KEY_RENEW_MARGIN_MS = 30 * MINUTE_MS;

// Lazily-created, cached service client — one per process.
let serviceClient: BlobServiceClient | undefined;

function getServiceClient(): BlobServiceClient {
  if (!serviceClient) {
    serviceClient = new BlobServiceClient(
      `https://${ACCOUNT}.blob.core.windows.net`,
      buildDataStoreCredential(),
    );
  }
  return serviceClient;
}

// Cached delegation key plus the moment it expires, so repeat SAS mints reuse it.
let cachedKey: UserDelegationKey | undefined;
let cachedKeyExpiresAt = 0;

async function getDelegationKey(): Promise<UserDelegationKey> {
  const now = Date.now();
  if (cachedKey && now < cachedKeyExpiresAt - KEY_RENEW_MARGIN_MS) {
    return cachedKey;
  }
  const startsOn = new Date(now - SKEW_MS);
  const expiresOn = new Date(now + KEY_LIFETIME_MS);
  const key = await getServiceClient().getUserDelegationKey(startsOn, expiresOn);
  cachedKey = key;
  cachedKeyExpiresAt = expiresOn.getTime();
  return key;
}

function getBlockBlobClient(blobPath: string) {
  return getServiceClient().getContainerClient(CONTAINER).getBlockBlobClient(blobPath);
}

/**
 * A create-only ("c") write SAS for a direct browser PUT. Short-lived (10min,
 * minus skew at the start) and pinned to the supplied content type so the upload
 * lands with the correct MIME. Returns the full `https` URL including the `?sas`.
 */
export async function mintWriteSas(blobPath: string, mime: ImageMime): Promise<string> {
  const key = await getDelegationKey();
  const now = Date.now();
  const sas = generateBlobSASQueryParameters(
    {
      containerName: CONTAINER,
      blobName: blobPath,
      permissions: BlobSASPermissions.parse("c"),
      protocol: SASProtocol.Https,
      startsOn: new Date(now - SKEW_MS),
      expiresOn: new Date(now + 10 * MINUTE_MS),
      contentType: mime,
    },
    key,
    ACCOUNT,
  ).toString();
  return `${getBlockBlobClient(blobPath).url}?${sas}`;
}

/**
 * A read-only ("r") SAS for a direct browser GET, valid for 3h (minus skew at the
 * start). Returns the full `https` URL including the `?sas`.
 */
export async function mintReadSas(blobPath: string): Promise<string> {
  const key = await getDelegationKey();
  const now = Date.now();
  const sas = generateBlobSASQueryParameters(
    {
      containerName: CONTAINER,
      blobName: blobPath,
      permissions: BlobSASPermissions.parse("r"),
      protocol: SASProtocol.Https,
      startsOn: new Date(now - SKEW_MS),
      expiresOn: new Date(now + 3 * HOUR_MS),
    },
    key,
    ACCOUNT,
  ).toString();
  return `${getBlockBlobClient(blobPath).url}?${sas}`;
}

/**
 * Reads blob metadata. A missing blob surfaces as `{ exists: false }` (a 404
 * `RestError`) rather than throwing, so callers can treat absence as data.
 */
export async function getBlobProperties(
  blobPath: string,
): Promise<{ exists: boolean; contentType?: string; contentLength?: number }> {
  try {
    const props = await getBlockBlobClient(blobPath).getProperties();
    return {
      exists: true,
      contentType: props.contentType,
      contentLength: props.contentLength,
    };
  } catch (error) {
    if (error instanceof RestError && error.statusCode === 404) {
      return { exists: false };
    }
    throw error;
  }
}

/** Deletes the blob if present (no-op when it is already gone). */
export async function deleteBlob(blobPath: string): Promise<void> {
  await getBlockBlobClient(blobPath).deleteIfExists();
}
