import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { META_LABEL } from "@/components/ui/meta-label";
import { codeModuleLabels, isCodeModule } from "@/lib/code-modules/types";
import { listRecentCodes } from "@/lib/recent-code-store";
import { cn } from "@/lib/utils";
import { HOME_MUTED } from "./home-ui";

// Recently used — the user's last opened activities, with their kind. Never
// depends on the achievements engine: the store degrades to an empty list.

export async function RecentList({ userId }: { userId: string }) {
  const recent = await listRecentCodes(userId);
  return (
    <>
      <h2 className={cn(META_LABEL, "mb-1.5")}>Recently used</h2>
      {recent.length === 0 ? (
        <p className={cn(HOME_MUTED, "py-1")}>
          Activities you open show up here, so you can get back to them in one click.
        </p>
      ) : (
        <ul className="grid gap-x-7 gap-y-0.5 md:grid-cols-2">
          {recent.map((item) => (
            <li key={item.code} className="min-w-0">
              <Link
                href={`/${item.code}`}
                title={item.code}
                className="-mx-2.5 flex items-center justify-between gap-2.5 rounded-lg px-2.5 py-2 hover:bg-foreground/5"
              >
                <span className="truncate">{item.note || item.code}</span>
                {isCodeModule(item.module) ? (
                  <Badge>{codeModuleLabels[item.module].badge}</Badge>
                ) : null}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

export function RecentListSkeleton() {
  return (
    <>
      <h2 className={cn(META_LABEL, "mb-1.5")}>Recently used</h2>
      <div className="grid gap-2 md:grid-cols-2" aria-hidden="true">
        {[0, 1, 2, 3].map((i) => (
          <span key={i} className="h-9 rounded-lg bg-foreground/5" />
        ))}
      </div>
    </>
  );
}
