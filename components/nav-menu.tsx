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
  { href: "/share-tutor", label: "Share Tutor", heading: "Share Tutor", teacherOnly: true },
  { href: "/health", label: "Health", heading: "Health", teacherOnly: true },
] as const;

export function NavMenu({ isTeacher }: { isTeacher: boolean }) {
  const pathname = usePathname();
  const { open, setOpen, ref } = usePopover<HTMLDivElement>();
  const items = NAV_ITEMS.filter((item) => isTeacher || !item.teacherOnly);
  // Heading lookup spans ALL items so a directly-opened URL still gets a title.
  const current = NAV_ITEMS.find((item) => item.href === pathname);
  const title = current ? `${BRAND} / ${current.heading}` : BRAND;

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
