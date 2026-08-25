// The mandatory, visually prominent "this waives anonymity" notice: a
// destructive-tinted rounded box with medium-weight small text. Shared by every
// surface that attributes an otherwise-anonymous action to the acting user —
// reports (`components/report-button.tsx`) and coding key issuance
// (`app/[code]/render-coding.tsx`), the two sanctioned user↔code links
// (`docs/reports.md`, `docs/coding.md`). A plain exported class string, not a
// component: each caller's copy differs, only the recipe is shared.
export const ATTRIBUTION_NOTICE =
  "rounded-lg border border-destructive/45 bg-destructive/10 px-3 py-2 font-medium text-sm";
