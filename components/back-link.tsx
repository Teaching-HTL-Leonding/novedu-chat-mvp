import Link from "next/link";
import type { ReactNode } from "react";

// The shared "← Back to …" link used on every sub-page that has a parent to
// return to (tutor-code stats, the conversation viewer, the YAML file create/edit
// pages). One component so the look stays identical everywhere. The arrow is part
// of the component; pass only the label as children.
export function BackLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link href={href} className="mb-3 inline-block font-semibold text-sm hover:underline">
      ← {children}
    </Link>
  );
}
