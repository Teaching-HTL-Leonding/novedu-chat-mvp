import { CARD_SECTION_PAD, cardVariants } from "@/components/ui/card";
import { dayOfMonth, type LocalDate, monthOf, weekdayOf } from "@/lib/achievements/time";

// Shared look of the start page's sections (docs/home.md). The cards are the
// app's content card (components/ui/card.ts).

export const HOME_CARD = cardVariants();

/** A card's inner padding (the card's own gutter, tighter on phones). */
export const HOME_CARD_PAD = CARD_SECTION_PAD;

/** A section's title row: the title, with its totals or note on the right. */
export const HOME_SECTION_HEAD =
  "mb-3.5 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1";

export const HOME_SECTION_TITLE = "text-balance font-semibold text-base tracking-tight";

/** A quiet line under a section title or beside a value. */
export const HOME_MUTED = "text-foreground/65 text-sm";

/** Small secondary text: captions, criteria, legends. */
export const HOME_CAPTION = "text-foreground/65 text-xs";

/** Month names for day labels, independent of the browser's locale. */
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export function monthLabel(month: number): string {
  return MONTHS[month] ?? "";
}

/** `2026-10-02` → `Fri 2 Oct`, computed on the date's own numbers (no time zone). */
export function dayLabel(date: LocalDate): string {
  return `${WEEKDAYS[weekdayOf(date)]} ${shortDayLabel(date)}`;
}

/** `2026-10-02` → `2 Oct`. */
export function shortDayLabel(date: LocalDate): string {
  return `${dayOfMonth(date)} ${MONTHS[monthOf(date)]}`;
}

export function plural(n: number, one: string, many: string): string {
  return `${n.toLocaleString("en")} ${n === 1 ? one : many}`;
}
