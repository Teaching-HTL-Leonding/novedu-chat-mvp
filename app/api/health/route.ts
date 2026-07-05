import {
  checkDb,
  checkFoundry,
  checkScch,
  resolveFoundryHost,
  resolveScchHost,
  resolveSqlHost,
} from "@/lib/health";
import { requireEffectiveTeacher } from "@/lib/student-mode";

// Teacher-only probe endpoint for the /health dashboard. Each probe is fetched
// individually (GET /api/health?probe=<name>) so the client can render every
// indicator as soon as ITS result arrives — a timing-out dependency (8 s cap
// inside lib/health.ts) never delays the rest. This route is the enforcement
// point; the page-level teacher check is only UX.
export const dynamic = "force-dynamic";

const PROBES = {
  db: checkDb,
  scch: checkScch,
  foundry: checkFoundry,
  "sql-host": resolveSqlHost,
  "scch-host": resolveScchHost,
  "foundry-host": resolveFoundryHost,
} as const;

export async function GET(req: Request) {
  try {
    await requireEffectiveTeacher();
  } catch {
    return Response.json({ error: "This operation requires a teacher account" }, { status: 403 });
  }

  const probe = new URL(req.url).searchParams.get("probe");
  const run = probe && probe in PROBES ? PROBES[probe as keyof typeof PROBES] : undefined;
  if (!run) {
    return Response.json(
      { error: `Unknown probe — expected one of: ${Object.keys(PROBES).join(", ")}` },
      { status: 400 },
    );
  }

  return Response.json(await run());
}
