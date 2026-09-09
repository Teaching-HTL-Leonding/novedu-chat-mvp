#!/usr/bin/env node
// Operator CLI: provisions the app-hosted image storage root — `npm run
// images:init-root`. Reads `IMAGE_STORAGE_ROOT` from the environment (the same
// variable the running app reads inside `verifyImageRoot()`), or accepts the
// root as a positional argument for a one-off / different-target run. Delegates
// all the actual filesystem work to `scripts/lib/image-root.mjs`, which is also
// what the e2e harness uses to provision `e2e/.image-root`.

import { initImageRoot } from "./lib/image-root.mjs";

const root = process.env.IMAGE_STORAGE_ROOT || process.argv[2];

if (!root) {
  console.error(
    "images:init-root: no root given — set IMAGE_STORAGE_ROOT or pass the path as an argument.",
  );
  process.exit(1);
}

try {
  const resolved = await initImageRoot(root);
  console.log(`images:init-root: provisioned ${resolved}`);
} catch (error) {
  console.error(`images:init-root: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
