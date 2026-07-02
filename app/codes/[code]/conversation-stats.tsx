import Link from "next/link";
import { TABLE_CLASSES, TD_CLASSES, TH_CLASSES } from "@/components/data-list";
import { Notice } from "@/components/notice";
import { buttonVariants } from "@/components/ui/button";
import { META_LABEL } from "@/components/ui/meta-label";
import { codeModuleLabels } from "@/lib/code-modules/types";
import { getCodeStats } from "@/lib/code-stats-store";
import type { CodeEntry } from "@/lib/code-store";
import { cn } from "@/lib/utils";
import { LocalTime } from "../../local-time";

const seconds = (date: Date) => Math.floor(date.getTime() / 1000);

// The shared per-code detail body for modules whose review centres on the chat: a
// summary (interaction count, and student count when attributed) plus a table of
// every qualifying conversation, each row linking to a read-only transcript. tutor
// and quiz render this from their `renderDetail`; writing renders it only as the
// fallback for an anonymous code (which has no savers). The count label
// ("Conversations" vs "Discussions") comes from the module's labels.
//
// SERVER COMPONENT: reads the database via `getCodeStats`. The descriptors call it
// as a plain function so no JSX lives in the server-only registry .ts files.
export async function ConversationStats({ entry }: { entry: CodeEntry }) {
  // Pass the code's frozen `anonymous` flag: the store nulls every userId and
  // zeroes studentCount for anonymous codes, so the privacy gate holds at the data
  // layer (the `!entry.anonymous` checks below are belt-and-braces).
  const stats = await getCodeStats(entry.code, entry.anonymous);
  const countLabel = codeModuleLabels[entry.module].countColumn;

  if (stats === undefined) {
    return (
      <Notice heading="Stats temporarily unavailable">
        <p>The stats could not be loaded right now. Try again in a moment.</p>
      </Notice>
    );
  }

  return (
    <>
      <dl className="mb-6 flex flex-wrap gap-4">
        <div className="min-w-32 rounded-lg border border-foreground/15 px-4 py-3">
          <dt className={`mb-1 ${META_LABEL}`}>{countLabel}</dt>
          <dd className="font-bold text-2xl leading-none">{stats.conversations}</dd>
        </div>
        {/* Per-student numbers exist only when the activity opted out of anonymity
            at create time. */}
        {!entry.anonymous ? (
          <div className="min-w-32 rounded-lg border border-foreground/15 px-4 py-3">
            <dt className={`mb-1 ${META_LABEL}`}>Students</dt>
            <dd className="font-bold text-2xl leading-none">{stats.studentCount}</dd>
          </div>
        ) : null}
      </dl>

      {stats.interactions.length === 0 ? (
        <p className="text-foreground/70">
          Nothing yet — a conversation counts once a student sends at least one message.
        </p>
      ) : (
        <table className={TABLE_CLASSES}>
          <thead>
            <tr>
              <th scope="col" className={TH_CLASSES}>
                First message
              </th>
              <th scope="col" className={TH_CLASSES}>
                Last message
              </th>
              {!entry.anonymous ? (
                <th scope="col" className={TH_CLASSES}>
                  Student
                </th>
              ) : null}
              <th scope="col" className={cn(TH_CLASSES, "text-right")}>
                User messages
              </th>
              <th scope="col" className={cn(TH_CLASSES, "w-[1%]")}>
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {stats.interactions.map((interaction) => (
              <tr key={interaction.threadId}>
                <td className={cn(TD_CLASSES, "whitespace-nowrap")}>
                  <LocalTime seconds={seconds(interaction.firstAt)} />
                </td>
                <td className={cn(TD_CLASSES, "whitespace-nowrap")}>
                  <LocalTime seconds={seconds(interaction.lastAt)} />
                </td>
                {!entry.anonymous ? (
                  <td
                    className={cn(
                      TD_CLASSES,
                      "max-w-72 overflow-hidden text-ellipsis whitespace-nowrap font-mono text-[0.85em]",
                    )}
                    title={interaction.userId ?? undefined}
                  >
                    {interaction.userName ?? interaction.userId ?? "—"}
                  </td>
                ) : null}
                <td className={cn(TD_CLASSES, "whitespace-nowrap text-right")}>
                  {interaction.userMessageCount}
                </td>
                <td className={cn(TD_CLASSES, "whitespace-nowrap text-right")}>
                  <Link
                    href={`/codes/${entry.code}/c/${interaction.threadId}`}
                    className={buttonVariants({ variant: "outline", size: "sm" })}
                  >
                    View
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}
