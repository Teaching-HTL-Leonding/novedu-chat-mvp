import type { ComponentProps } from "react";

// Stand-in for `next/link` in tests: the real one reads Next-server globals and
// needs a router. A plain anchor keeps the href the assertions read.

// next/link is CJS: without this flag the browser project hands the component
// the whole module object as its default import.
export const __esModule = true;

export default function Link(props: ComponentProps<"a">) {
  return <a {...props} />;
}
