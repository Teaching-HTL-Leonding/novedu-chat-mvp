import type { ReactNode } from "react";
import { BookOpenIcon, ExternalLinkIcon } from "@/components/icons";
import { buttonVariants } from "@/components/ui/button";
import { getTeacherHome } from "@/lib/home-data";
import { TEACHER_GUIDE_URL } from "@/lib/teacher-guide";
import { cn } from "@/lib/utils";
import { HOME_MUTED } from "./home-ui";

// The teacher start page's header: the greeting and the Teacher Guide (static,
// flushed at once). `note` is the Suspense slot for the one line a teacher
// without any code sees instead of the dashboard.
export function TeacherHeader({ firstName, note }: { firstName: string; note: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5 pt-1">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
        <h1 className="text-balance font-bold text-2xl tracking-tight">
          {firstName ? `Welcome back, ${firstName}` : "Welcome back"}
        </h1>
        <a
          href={TEACHER_GUIDE_URL}
          target="_blank"
          rel="noopener"
          className={cn(buttonVariants({ variant: "outline" }))}
        >
          <BookOpenIcon />
          Teacher Guide
          <ExternalLinkIcon className="size-3! opacity-60" />
          <span className="sr-only">(opens in a new tab)</span>
        </a>
      </div>
      {note}
    </div>
  );
}

/** "You haven't shared an activity yet" — only for a teacher without any code. */
export async function TeacherIntroNote({ userId }: { userId: string }) {
  const { hasCodes } = await getTeacherHome(userId);
  if (hasCodes !== false) return null;
  return (
    <p className={cn(HOME_MUTED, "max-w-prose")}>
      You haven't shared an activity yet. The Teacher Guide shows you how to write one and share its
      code.
    </p>
  );
}
