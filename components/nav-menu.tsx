"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import styles from "./nav-menu.module.css";
import { usePopover } from "./use-popover";

const BRAND = "HTBLA Leonding - Novedu";

// Single source of truth for both the burger menu items and the per-route page
// heading shown after the brand in the status bar.
const NAV_ITEMS = [
  { href: "/", label: "Chat", heading: "Chat Prototype" },
  { href: "/validate-tutor", label: "Validate Tutor", heading: "Validate Tutor" },
] as const;

export function NavMenu() {
  const pathname = usePathname();
  const { open, setOpen, ref } = usePopover<HTMLDivElement>();
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
            {NAV_ITEMS.map((item) => (
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
