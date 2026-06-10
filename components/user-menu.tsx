"use client";

import { signOutAction } from "@/lib/auth-actions";
import { usePopover } from "./use-popover";
import styles from "./user-menu.module.css";

type StatusBarUser = {
  name?: string | null;
  image?: string | null;
  isTeacher?: boolean;
};

// Up to two initials from the user's name for the avatar placeholder.
function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const first = parts[0]?.[0] ?? "";
  const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? "") : "";
  return (first + last).toUpperCase() || "?";
}

export function UserMenu({ user }: { user: StatusBarUser | null }) {
  const { open, setOpen, ref } = usePopover<HTMLDivElement>();
  if (!user) return null;
  const name = user.name?.trim() || "Signed in";

  return (
    <div className={styles.user} ref={ref}>
      <button
        type="button"
        className={styles.trigger}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        {user.isTeacher && (
          <span
            className={styles.teacher}
            role="img"
            title="Teacher — may perform teacher-only operations"
            aria-label="Teacher"
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="currentColor"
              aria-hidden="true"
              focusable="false"
            >
              <path d="M12 3 1 9l11 6 9-4.91V17h2V9L12 3zM5 13.18v3.82c0 .73 3.13 3 7 3s7-2.27 7-3v-3.82l-7 3.82-7-3.82z" />
            </svg>
          </span>
        )}
        <span className={styles.name}>{name}</span>
        {user.image ? (
          // Avatar URLs are external (Entra/Graph); a plain <img> avoids
          // configuring next/image remote patterns for a tiny 28px avatar.
          // biome-ignore lint/performance/noImgElement: external avatar, not worth next/image config
          <img className={styles.avatar} src={user.image} alt="" width={28} height={28} />
        ) : (
          <span className={styles.avatar} aria-hidden="true">
            {initials(name)}
          </span>
        )}
      </button>
      {open && (
        <div className={styles.menu} role="menu">
          <form action={signOutAction}>
            <button type="submit" role="menuitem" className={styles.signOut}>
              Sign out
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
