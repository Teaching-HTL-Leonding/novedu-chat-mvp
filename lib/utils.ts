import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

// App-wide className combiner: clsx resolves conditionals/arrays, tailwind-merge
// makes caller-supplied utilities override a component's defaults on conflict
// (cn("p-2", "p-4") → "p-4"). Every component exposing a `className` prop merges
// it with cn() so callers can pass deltas instead of replacements.
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
