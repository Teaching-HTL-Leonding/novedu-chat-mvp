import type { SVGProps } from "react";

// Shared inline icons (Feather-style, MIT) for action buttons across the app
// (YAML Files, Shared Tutor Codes, …). Pure presentation — no "use client", so
// they work in both server and client components. Always `aria-hidden`: the
// surrounding button/link carries the accessible label, so the icon is decorative.
function Icon({ children, ...props }: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...props}
    >
      {children}
    </svg>
  );
}

/** Overlapping pages — "Copy". */
export const CopyIcon = (props: SVGProps<SVGSVGElement>) => (
  <Icon {...props}>
    <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
  </Icon>
);

/** Check mark — copy succeeded. */
export const CheckIcon = (props: SVGProps<SVGSVGElement>) => (
  <Icon {...props}>
    <polyline points="20 6 9 17 4 12" />
  </Icon>
);

/** Box with an out-arrow — "Open in a new tab" (raw YAML, chat, …). */
export const ExternalLinkIcon = (props: SVGProps<SVGSVGElement>) => (
  <Icon {...props}>
    <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
    <polyline points="15 3 21 3 21 9" />
    <line x1="10" y1="14" x2="21" y2="3" />
  </Icon>
);

/** Pencil — "Edit". */
export const EditIcon = (props: SVGProps<SVGSVGElement>) => (
  <Icon {...props}>
    <path d="M12 20h9" />
    <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z" />
  </Icon>
);

/** Trash can — "Delete". */
export const TrashIcon = (props: SVGProps<SVGSVGElement>) => (
  <Icon {...props}>
    <polyline points="3 6 5 6 21 6" />
    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
    <line x1="10" y1="11" x2="10" y2="17" />
    <line x1="14" y1="11" x2="14" y2="17" />
  </Icon>
);

/** Share nodes — "Create tutor code from this file". */
export const ShareIcon = (props: SVGProps<SVGSVGElement>) => (
  <Icon {...props}>
    <circle cx="18" cy="5" r="3" />
    <circle cx="6" cy="12" r="3" />
    <circle cx="18" cy="19" r="3" />
    <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" />
    <line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
  </Icon>
);

/** Bar chart — "View stats". */
export const StatsIcon = (props: SVGProps<SVGSVGElement>) => (
  <Icon {...props}>
    <line x1="18" y1="20" x2="18" y2="10" />
    <line x1="12" y1="20" x2="12" y2="4" />
    <line x1="6" y1="20" x2="6" y2="14" />
  </Icon>
);
