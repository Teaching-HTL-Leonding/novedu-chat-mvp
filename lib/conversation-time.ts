// The time label of a conversation in the tutor's "Previous conversations":
// "Today, 14:32", "Yesterday, 09:10", "Mon, 6 Oct, 11:05", "6 Oct 2025, 11:05".
// Formatted in the browser's locale and time zone, so it is only ever called
// client-side (the server render never formats it). Pure: `now` is passed in.

function sameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function capitalise(text: string): string {
  return text.charAt(0).toLocaleUpperCase() + text.slice(1);
}

export function formatConversationTime(date: Date, now: Date, locale?: string): string {
  const time = new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit" }).format(date);
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);

  if (sameDay(date, now) || sameDay(date, yesterday)) {
    // "today" / "yesterday" in the locale's own words.
    const day = new Intl.RelativeTimeFormat(locale, { numeric: "auto" }).format(
      sameDay(date, now) ? 0 : -1,
      "day",
    );
    return `${capitalise(day)}, ${time}`;
  }
  if (date.getFullYear() === now.getFullYear()) {
    const day = new Intl.DateTimeFormat(locale, {
      weekday: "short",
      day: "numeric",
      month: "short",
    }).format(date);
    return `${day}, ${time}`;
  }
  const day = new Intl.DateTimeFormat(locale, {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(date);
  return `${day}, ${time}`;
}
