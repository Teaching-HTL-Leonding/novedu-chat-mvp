"use client";

import { useEffect, useState } from "react";
import { IconButton } from "@/components/ui/icon-button";
import { cn } from "@/lib/utils";

// A coloured ribbon under the status bar naming the environment this page runs
// in, so nobody works on DEV (or a local server) by mistake. The environment is
// read from the browser's own hostname — the server renders nothing and the
// ribbon appears after hydration. The "X" hides it for the rest of the tab's
// session; the root layout persists across client navigations, so it never
// re-appears while someone works. The teacher guide shows the same colours in
// teacher-docs/src/components/Banner.astro.

export type AppEnvironment = "local" | "dev" | "prod";

export function environmentForHost(hostname: string): AppEnvironment | null {
  switch (hostname.toLowerCase()) {
    case "localhost":
    case "127.0.0.1":
    case "[::1]":
      return "local";
    case "dev.novedu.at":
      return "dev";
    case "app.novedu.at":
      return "prod";
    default:
      return null;
  }
}

const ENVIRONMENTS_CHAPTER = "/docs/00-introduction/07-environments";

const RIBBONS: Record<
  AppEnvironment,
  { label: string; className: string; message: string; link?: { href: string; text: string } }
> = {
  local: {
    label: "LOCAL",
    className: "bg-violet-700 text-white",
    message: "You are working in a local development environment on this computer.",
  },
  dev: {
    label: "DEV",
    className: "bg-amber-400 text-slate-900",
    message:
      "Development environment for trying new features and experimenting with activities, with no guarantee of availability or data. Use PROD for your classes.",
    link: { href: ENVIRONMENTS_CHAPTER, text: "Learn more" },
  },
  prod: {
    label: "PROD",
    className: "bg-emerald-100 text-emerald-900",
    message:
      "Production environment for your classes. Missing your codes or files from the prototype phase?",
    link: {
      href: `${ENVIRONMENTS_CHAPTER}#what-we-had-during-the-prototype-phase`,
      text: "Read what happened",
    },
  },
};

const DISMISSED_KEY = "novedu-env-ribbon-dismissed";

export function EnvironmentRibbon() {
  const [env, setEnv] = useState<AppEnvironment | null>(null);

  useEffect(() => {
    try {
      if (sessionStorage.getItem(DISMISSED_KEY)) return;
    } catch {
      // Storage blocked — show the ribbon; dismissal then lasts until the next load.
    }
    setEnv(environmentForHost(window.location.hostname));
  }, []);

  if (!env) return null;
  const ribbon = RIBBONS[env];

  function dismiss() {
    try {
      sessionStorage.setItem(DISMISSED_KEY, "1");
    } catch {
      // Storage blocked — hidden until the next full page load.
    }
    setEnv(null);
  }

  return (
    <aside
      aria-label="Environment"
      className={cn("flex shrink-0 items-center gap-3 px-5 py-1.5 text-sm", ribbon.className)}
    >
      <p className="min-w-0 flex-1">
        <strong className="font-bold">{ribbon.label}</strong> · {ribbon.message}{" "}
        {ribbon.link && (
          // The guide is a static export with no way back into the app (as in
          // the nav menu), so it opens in its own tab.
          <a href={ribbon.link.href} target="_blank" rel="noopener" className="underline">
            {ribbon.link.text}
          </a>
        )}
      </p>
      <IconButton
        aria-label="Hide this notice"
        onClick={dismiss}
        className="size-6 border-0 text-base not-disabled:hover:bg-current/15"
      >
        ×
      </IconButton>
    </aside>
  );
}
