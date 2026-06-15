"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import styles from "./nav-menu.module.css";
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
    href: "/share-tutor",
    label: "Create Tutor Code",
    heading: "Create Tutor Code",
    teacherOnly: true,
  },
  {
    href: "/tutor-codes",
    label: "Shared Tutor Codes",
    heading: "Shared Tutor Codes",
    teacherOnly: true,
  },
  { href: "/files", label: "YAML Files", heading: "YAML Files", teacherOnly: true },
  { href: "/health", label: "Health", heading: "Health", teacherOnly: true },
] as const;

// Dynamic routes have no fixed NAV_ITEMS entry, but they still need a status-bar
// heading (the pages themselves render no title — the bar is the single source).
// Matched on the path shape: the tutor code carries no title we know client-side,
// so a static heading per route is shown.
function dynamicHeading(pathname: string): string | undefined {
  const segments = pathname.split("/").filter(Boolean);
  if (segments[0] === "tutor-codes" && segments.length >= 2) {
    // /tutor-codes/<code>            → stats
    // /tutor-codes/<code>/c/<thread> → a single conversation
    return segments[2] === "c" ? "Conversation" : "Tutor Code Stats";
  }
  if (segments[0] === "files") {
    // /files/new            → create
    // /files/edit/<name…>   → edit (needs the name segment; bare /files/edit
    //                          is not a real page, so it gets no special heading)
    if (segments[1] === "new") return "New YAML File";
    if (segments[1] === "edit" && segments.length >= 3) return "Edit YAML File";
  }
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
    <div className={styles.nav} ref={ref}>
      <button
        type="button"
        className={styles.burger}
        aria-label="Open navigation menu"
        aria-haspopup="true"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <span className={styles.burgerBar} />
        <span className={styles.burgerBar} />
        <span className={styles.burgerBar} />
      </button>
      <span className={styles.title}>{title}</span>
      {open && (
        <nav className={styles.menu} aria-label="Primary">
          <ul className={styles.menuList}>
            {items.map((item) => (
              <li key={item.href}>
                <Link
                  href={item.href}
                  className={`${styles.menuItem} ${item.href === pathname ? styles.active : ""}`}
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
