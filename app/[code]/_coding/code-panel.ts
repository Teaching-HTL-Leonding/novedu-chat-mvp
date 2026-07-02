// The coding module's mono code panel, shared by the client connection view
// (coding-connection.tsx) and the SERVER teacher detail (coding-detail.tsx).
// It must live outside the "use client" module: a server component importing a
// non-component value from a client module gets an RSC client-reference proxy,
// not the string (the class attribute would render the proxy's source).
export const CODE_PANEL =
  "overflow-x-auto rounded-lg border border-foreground/15 bg-foreground/5 px-3.5 py-3 text-sm leading-normal";
