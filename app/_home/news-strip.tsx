import { getStudentHome } from "@/lib/home-data";
import { plural } from "./home-ui";
import { SeenMarker } from "./seen-marker";

// The quiet "new badges" strip: a count, no overlay, nothing to click. It renders
// only when there is something new; once rendered, the client marks those
// badges as seen, so the next visit no longer shows it.
export async function NewsStrip({ userId }: { userId: string }) {
  const home = await getStudentHome(userId);
  const ids = home.newIds ?? [];
  if (ids.length === 0) return null;
  return (
    <p
      role="status"
      className="flex items-center gap-2.5 rounded-lg border border-amber-line bg-amber-wash px-4 py-2 text-amber-ink text-sm"
    >
      <span
        aria-hidden="true"
        className="size-2.5 flex-none rounded-full bg-brand-amber ring-3 ring-amber-halo"
      />
      <span>
        You earned <b className="font-semibold">{plural(ids.length, "new badge", "new badges")}</b>{" "}
        since your last visit.
      </span>
      <SeenMarker ids={ids} />
    </p>
  );
}
