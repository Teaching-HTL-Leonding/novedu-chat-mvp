"use client";

// Renders a unix timestamp (seconds) in the VIEWER's local time. Must be a
// client component — the server doesn't know the user's timezone. The server
// render uses the server's zone; suppressHydrationWarning lets the client
// correct it without a hydration error. A `null` timestamp (e.g. an open-ended
// code's missing window bound) renders the `fallback` text instead.
export function LocalTime({
  seconds,
  fallback = "—",
}: {
  seconds: number | null;
  fallback?: string;
}) {
  if (seconds === null) return <span>{fallback}</span>;
  const date = new Date(seconds * 1000);
  return (
    <time dateTime={date.toISOString()} suppressHydrationWarning>
      {date.toLocaleString()}
    </time>
  );
}
