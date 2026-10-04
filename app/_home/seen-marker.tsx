"use client";

import { useEffect, useRef } from "react";
import { markAchievementsSeen } from "@/lib/achievement-actions";

// Once the new-badges strip has rendered, marks exactly the badges it announced
// as seen — once per mount, never again on a re-render. A failure is silent:
// the badges simply stay "new" until the next visit retries.
export function SeenMarker({ ids }: { ids: string[] }) {
  const sent = useRef(false);
  // biome-ignore lint/correctness/useExhaustiveDependencies: the ids announced at mount are the ones to mark; later renders must not mark again.
  useEffect(() => {
    if (sent.current || ids.length === 0) return;
    sent.current = true;
    markAchievementsSeen(ids).catch(() => {});
  }, []);
  return null;
}
