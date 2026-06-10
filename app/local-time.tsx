"use client";

// Renders a unix timestamp (seconds) in the VIEWER's local time. Must be a
// client component — the server doesn't know the user's timezone. The server
// render uses the server's zone; suppressHydrationWarning lets the client
// correct it without a hydration error.
export function LocalTime({ seconds }: { seconds: number }) {
  const date = new Date(seconds * 1000);
  return (
    <time dateTime={date.toISOString()} suppressHydrationWarning>
      {date.toLocaleString()}
    </time>
  );
}
