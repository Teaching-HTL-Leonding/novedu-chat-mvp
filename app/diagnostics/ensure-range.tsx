"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect } from "react";

// The server cannot know the viewer's time zone, and "Today" depends on it. A bare
// /diagnostics (or a preset without `tz`) renders this instead of querying: it
// adds `range=today` when no range is set and the browser's IANA zone, then
// replaces the URL. The server treats a present-but-unknown zone as UTC, so this
// never loops.

export function EnsureRange() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  useEffect(() => {
    const params = new URLSearchParams(searchParams);
    if (!params.get("range")) params.set("range", "today");
    params.set("tz", Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC");
    router.replace(`${pathname}?${params.toString()}`);
  }, [router, pathname, searchParams]);

  return (
    <p className="text-foreground/60 text-sm" role="status">
      Resolving your time zone…
    </p>
  );
}
