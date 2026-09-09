import type { TokenCredential } from "@azure/identity";
import { BlobServiceClient } from "@azure/storage-blob";
import { ShareServiceClient } from "@azure/storage-file-share";
import type { DestinationStore, WritableSourceStore } from "./types";

// The two Azure seams behind `core.ts`, and the ONLY place this tool speaks to
// Azure. Both authenticate PASSWORDLESS with the Entra credential the app itself
// uses for its data stores (`buildDataStoreCredential()`) — never an account key,
// never a SAS, never a connection string.
//
// The Files side goes over the REST data plane with
// `fileRequestIntent: "backup"`, the header Azure requires before an OAuth token
// may bypass file/directory ACLs. That needs the Storage File Data Privileged
// Contributor role on the account and needs NO SMB mount and NO port 445 on the
// operator's machine (scripts/images/README.md).
//
// Neither seam exposes a delete: `SourceStore` is read-only apart from the
// rollback `put`, which is create-only (`ifNoneMatch: "*"`), and
// `DestinationStore` only ever writes objects `core.ts` has just found absent.
//
// OPERATOR TOOLING, never bundled into the app or the CLI (scripts/images/README.md).

/** The adapter's layout under the share root: `images/<key>/content`. */
const OBJECTS_DIR = "images";
const CONTENT_FILE = "content";

function statusCode(error: unknown): number | undefined {
  return typeof error === "object" && error !== null
    ? ((error as { statusCode?: unknown }).statusCode as number | undefined)
    : undefined;
}

/** A 404 is DATA here ("no such object"), not a failure — every other error throws. */
function isNotFound(error: unknown): boolean {
  return statusCode(error) === 404;
}

/**
 * Reads (and, for the rollback only, writes) the Blob container the images are
 * migrated FROM.
 */
export function blobSource(
  account: string,
  container: string,
  credential: TokenCredential,
): WritableSourceStore {
  const service = new BlobServiceClient(`https://${account}.blob.core.windows.net`, credential);
  const containerClient = service.getContainerClient(container);

  return {
    async get(key) {
      const blob = containerClient.getBlobClient(key);
      try {
        const properties = await blob.getProperties();
        const bytes = await blob.downloadToBuffer();
        return { bytes, contentType: properties.contentType ?? null };
      } catch (error) {
        if (isNotFound(error)) return null;
        throw error;
      }
    },

    async *list() {
      for await (const item of containerClient.listBlobsFlat()) {
        yield item.name;
      }
    },

    async put(key, bytes, contentType) {
      const buffer = Buffer.from(bytes);
      // CREATE-ONLY: `ifNoneMatch: "*"` makes the service refuse the request with
      // 409 when the blob already exists, so a rollback copy can never overwrite
      // an object the previous release still relies on.
      await containerClient.getBlockBlobClient(key).upload(buffer, buffer.byteLength, {
        blobHTTPHeaders: { blobContentType: contentType },
        conditions: { ifNoneMatch: "*" },
      });
    },
  };
}

/**
 * Reads and writes the Azure Files share the images are migrated TO — the same
 * share the App Service path mapping presents to the app as
 * `IMAGE_STORAGE_ROOT`, in exactly the `images/<key>/content` layout
 * `lib/image-fs.ts` expects.
 *
 * The `.novedu-files-root` sentinel is NOT written here: provisioning the root
 * is the operator's explicit step (`npm run images:init-root` against the
 * mounted path), so a copy run can never turn a wrong share into a plausible
 * storage root.
 */
export function filesDestination(
  account: string,
  share: string,
  credential: TokenCredential,
): DestinationStore {
  const service = new ShareServiceClient(`https://${account}.file.core.windows.net`, credential, {
    // Required for OAuth over the Files REST data plane — without it every data
    // operation is refused.
    fileRequestIntent: "backup",
  });
  const shareClient = service.getShareClient(share);
  const objectsDir = shareClient.getDirectoryClient(OBJECTS_DIR);

  return {
    async read(key) {
      const file = objectsDir.getDirectoryClient(key).getFileClient(CONTENT_FILE);
      try {
        return await file.downloadToBuffer();
      } catch (error) {
        if (isNotFound(error)) return null;
        throw error;
      }
    },

    async write(key, bytes, contentType) {
      // Idempotent: `images/` survives from the operator's provisioning step and
      // the object directory from an earlier attempt at the same key.
      await objectsDir.createIfNotExists();
      const objectDir = objectsDir.getDirectoryClient(key);
      await objectDir.createIfNotExists();
      await objectDir.getFileClient(CONTENT_FILE).uploadData(Buffer.from(bytes), {
        fileHttpHeaders: { fileContentType: contentType },
      });
    },
  };
}
