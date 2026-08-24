"use client";

import Link from "next/link";
import { type ReactNode, useEffect, useState } from "react";
import { rememberedListHref } from "./list-filter-memory";

// The shared "← Back to …" link used on every sub-page that has a parent to
// return to (tutor-code stats, the conversation viewer, the YAML file create/edit
// pages). One component so the look stays identical everywhere. The arrow is part
// of the component; pass only the label as children.
//
// When the parent is a LIST the teacher left filtered, the link returns them to
// that filter (`components/list-filter-memory.ts`). The href is resolved after
// mount, so the server-rendered markup keeps the plain href and hydration matches;
// because it is a real href, middle-click and "open in new tab" carry the filter
// too. Any other href — `/codes/<code>`, say — simply has nothing remembered.
export function BackLink({ href, children }: { href: string; children: ReactNode }) {
  const [resolved, setResolved] = useState(href);
  useEffect(() => setResolved(rememberedListHref(href)), [href]);

  return (
    <Link href={resolved} className="mb-3 inline-block font-semibold text-sm hover:underline">
      ← {children}
    </Link>
  );
}
