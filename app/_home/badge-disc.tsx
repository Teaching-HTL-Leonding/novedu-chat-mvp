import type { ComponentType, SVGProps } from "react";
import {
  CalendarIcon,
  CheckSquareIcon,
  CodeIcon,
  EditIcon,
  FlameIcon,
  KeyIcon,
  LayersIcon,
  SendIcon,
  ToolIcon,
  ZapIcon,
} from "@/components/icons";
import type { BadgeIcon } from "@/lib/achievements/catalog";
import { cn } from "@/lib/utils";

// A badge's round disc: the family colour with the badge's icon, or an outlined
// "locked" disc for one not yet earned. Server-safe (no "use client"), so the
// calendar's client island renders the same disc.

const ICONS: Record<BadgeIcon, ComponentType<SVGProps<SVGSVGElement>>> = {
  flame: FlameIcon,
  calendar: CalendarIcon,
  check: CheckSquareIcon,
  pen: EditIcon,
  key: KeyIcon,
  send: SendIcon,
  code: CodeIcon,
  tool: ToolIcon,
  layers: LayersIcon,
  zap: ZapIcon,
};

/** Family → its colour as a background utility (tokens in app/globals.css). */
export const FAMILY_BG: Record<string, string> = {
  rhythm: "bg-fam-rhythm",
  practice: "bg-fam-practice",
  coding: "bg-fam-coding",
  secret: "bg-fam-secret",
};

/** Family → the glyph colour on its disc: white, except the secret family's amber. */
export function familyInk(family: string): string {
  return family === "secret" ? "text-brand-amber" : "text-white";
}

export function BadgeGlyph({ icon, className }: { icon: BadgeIcon; className?: string }) {
  const Glyph = ICONS[icon];
  return <Glyph className={className} />;
}

export function BadgeDisc({
  icon,
  family,
  locked = false,
  isNew = false,
  size = "md",
}: {
  icon: BadgeIcon;
  family: string;
  locked?: boolean;
  isNew?: boolean;
  size?: "sm" | "md";
}) {
  return (
    <span
      className={cn(
        "grid flex-none place-items-center rounded-full",
        size === "md" ? "size-10 [&_svg]:size-5" : "size-8 [&_svg]:size-4",
        locked
          ? "bg-card text-foreground/55 ring-1 ring-foreground/25 ring-inset"
          : cn(FAMILY_BG[family] ?? "bg-foreground", familyInk(family)),
        isNew && "ring-2 ring-brand-amber ring-offset-2 ring-offset-card",
      )}
    >
      <BadgeGlyph icon={icon} />
    </span>
  );
}
