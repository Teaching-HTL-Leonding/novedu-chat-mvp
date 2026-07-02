"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { iconButtonVariants } from "@/components/ui/icon-button";
import { MENU_ITEM, MENU_PANEL } from "@/components/ui/menu";
import { cn } from "@/lib/utils";
import { usePopover } from "./use-popover";

const BRAND = "HTBLA Leonding - Novedu";

// Single source of truth for both the burger menu items and the per-route page
// heading shown after the brand in the status bar. Teacher-only items are hidden
// from the menu for non-teachers (the pages themselves enforce the rule
// server-side; this is just honest navigation).
const NAV_ITEMS = [
  { href: "/", label: "Chat", heading: "Chat Prototype", teacherOnly: false },
  {
    href: "/validate-tutor",
    label: "Validate Tutor",
    heading: "Validate Tutor",
    teacherOnly: true,
  },
  {
    href: "/codes",
    label: "Codes",
    heading: "Codes",
    teacherOnly: true,
  },
  { href: "/files", label: "YAML Files", heading: "YAML Files", teacherOnly: true },
  { href: "/images", label: "Images", heading: "Images", teacherOnly: true },
  { href: "/health", label: "Health", heading: "Health", teacherOnly: true },
] as const;

// Dynamic routes have no fixed NAV_ITEMS entry, but they still need a status-bar
// heading (the pages themselves render no title — the bar is the single source).
// Matched on the path shape: the code carries no title we know client-side, so a
// static heading per route is shown.
function dynamicHeading(pathname: string): string | undefined {
  const segments = pathname.split("/").filter(Boolean);
  if (segments[0] === "codes" && segments.length >= 2) {
    // /codes/new              → create
    // /codes/edit/<code>      → edit
    // /codes/<code>           → stats
    // /codes/<code>/c/<thread> → a single conversation
    if (segments[1] === "new") return "New Code";
    if (segments[1] === "edit") return "Edit Code";
    return segments[2] === "c" ? "Conversation" : "Code Stats";
  }
  if (segments[0] === "files") {
    // /files/new            → create
    // /files/edit/<name…>   → edit (needs the name segment; bare /files/edit
    //                          is not a real page, so it gets no special heading)
    if (segments[1] === "new") return "New YAML File";
    if (segments[1] === "edit" && segments.length >= 3) return "Edit YAML File";
  }
  if (segments[0] === "images" && segments[1] === "new") return "New Image";
  return undefined;
}

export function NavMenu({ isTeacher }: { isTeacher: boolean }) {
  const pathname = usePathname();
  const { open, setOpen, ref } = usePopover<HTMLDivElement>();
  const items = NAV_ITEMS.filter((item) => isTeacher || !item.teacherOnly);
  // Heading lookup spans ALL items so a directly-opened URL still gets a title;
  // dynamic routes (the stats/conversation pages) fall back to a path-shape match.
  const heading =
    NAV_ITEMS.find((item) => item.href === pathname)?.heading ?? dynamicHeading(pathname);
  const title = heading ? `${BRAND} / ${heading}` : BRAND;

  return (
    <div className="relative flex min-w-0 items-center gap-3" ref={ref}>
      <button
        type="button"
        // The icon-button recipe (incl. its focus ring) in the burger's layout:
        // a column of three bars instead of a centered svg.
        className={cn(
          iconButtonVariants(),
          "flex-col gap-1 border-foreground/15 bg-background p-2",
        )}
        aria-label="Open navigation menu"
        aria-haspopup="true"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <span className="block h-0.5 w-full rounded-full bg-foreground" />
        <span className="block h-0.5 w-full rounded-full bg-foreground" />
        <span className="block h-0.5 w-full rounded-full bg-foreground" />
      </button>
      <span className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap font-semibold">
        {title}
      </span>
      {open && (
        <nav className={cn(MENU_PANEL, "left-0 min-w-44")} aria-label="Primary">
          <ul>
            {items.map((item) => (
              <li key={item.href}>
                <Link
                  href={item.href}
                  className={cn(
                    MENU_ITEM,
                    item.href === pathname && "bg-foreground/5 font-semibold",
                  )}
                  onClick={() => setOpen(false)}
                >
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      )}
    </div>
  );
}
