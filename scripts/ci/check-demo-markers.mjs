#!/usr/bin/env node
// Proves which sign-in mode a build carries (docs/auth.md, "Demo mode"): greps the
// COMPILED output for the two literals only a demo build uses at runtime — the
// public demo password (lib/demo-personas.ts) and the demo boot log line
// (lib/demo-boot.ts).
//
//   node scripts/ci/check-demo-markers.mjs <dir> --expect absent|present
//
// <dir> is a `.next` directory (after `next build`) or the root of a built image's
// /app. Only compiled output is read: `server/` + `static/` (and, in a standalone
// tree, `server.js` + `.next/server` + `.next/static`). Never `.next/dev` or
// `.next/cache` — a local demo `npm run dev` leaves demo chunks there, and the
// build's cleanup keeps both — and never the rest of a standalone tree, where file
// tracing may copy source files.
//
// Both literals are read from the source tree, so the check fails (instead of
// passing vacuously) when either is renamed away.

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = fileURLToPath(new URL("../..", import.meta.url));

function literal(file, name) {
  const source = readFileSync(join(REPO_ROOT, file), "utf8");
  const match = new RegExp(`export const ${name} =\\s*"([^"]+)"`).exec(source);
  if (!match) {
    console.error(`check-demo-markers: ${name} not found in ${file} — update this script`);
    process.exit(2);
  }
  return match[1];
}

// A minifier may escape non-ASCII characters (the log line's em dash).
function variants(text) {
  const escaped = (upper) =>
    text.replace(/[^\x20-\x7e]/g, (ch) => {
      const hex = ch.charCodeAt(0).toString(16).padStart(4, "0");
      return `\\u${upper ? hex.toUpperCase() : hex}`;
    });
  return [...new Set([text, escaped(false), escaped(true)])];
}

const [dir, flag, expect] = process.argv.slice(2);
if (!dir || flag !== "--expect" || !["absent", "present"].includes(expect)) {
  console.error("usage: check-demo-markers.mjs <dir> --expect absent|present");
  process.exit(2);
}

const markers = [
  { name: "DEMO_PASSWORD", text: literal("lib/demo-personas.ts", "DEMO_PASSWORD") },
  { name: "DEMO_BOOT_LOG_LINE", text: literal("lib/demo-boot.ts", "DEMO_BOOT_LOG_LINE") },
];

const roots = [
  "server",
  "static",
  "standalone/server.js",
  "standalone/.next/server",
  "server.js",
  ".next/server",
  ".next/static",
]
  .map((path) => join(dir, path))
  .filter((path) => existsSync(path));
if (roots.length === 0) {
  console.error(`check-demo-markers: no compiled output under ${dir}`);
  process.exit(2);
}

function* files(path) {
  if (statSync(path).isFile()) {
    yield path;
    return;
  }
  for (const entry of readdirSync(path, { withFileTypes: true })) {
    const child = join(path, entry.name);
    if (entry.isDirectory()) yield* files(child);
    else if (entry.isFile()) yield child;
  }
}

const found = new Map(markers.map((marker) => [marker.name, []]));
let scanned = 0;
for (const root of roots) {
  for (const file of files(root)) {
    scanned++;
    const content = readFileSync(file, "utf8");
    for (const marker of markers) {
      if (variants(marker.text).some((v) => content.includes(v))) {
        found.get(marker.name).push(relative(dir, file));
      }
    }
  }
}

console.log(
  `check-demo-markers: scanned ${scanned} files in ${roots.map((r) => relative(dir, r) || ".").join(", ")}`,
);
let failed = false;
for (const marker of markers) {
  const hits = found.get(marker.name);
  if (expect === "absent" && hits.length > 0) {
    failed = true;
    console.error(`  ${marker.name} found (expected absent) in:\n    ${hits.join("\n    ")}`);
  } else if (expect === "present" && hits.length === 0) {
    failed = true;
    console.error(`  ${marker.name} not found (expected present)`);
  } else {
    console.log(`  ${marker.name}: ${expect} ✓${hits.length ? ` (${hits.length} files)` : ""}`);
  }
}
process.exit(failed ? 1 : 0);
