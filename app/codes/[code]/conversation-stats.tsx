import Link from "next/link";
import { type ListColumn, ListTable } from "@/components/data-list";
import { Notice } from "@/components/notice";
import { buttonVariants } from "@/components/ui/button";
import { StatTile } from "@/components/ui/stat-tile";
import { codeModuleLabels } from "@/lib/code-modules/types";
import { getCodeStats, type Interaction } from "@/lib/code-stats-store";
import type { CodeEntry } from "@/lib/code-store";
import { LocalTime } from "../../local-time";

const seconds = (date: Date) => Math.floor(date.getTime() / 1000);

// The shared per-code detail body for modules whose review centres on the chat: a
// summary (interaction count, and student count when attributed) plus a table of
// every qualifying conversation, each row linking to a read-only transcript. tutor
// and quiz render this from their `renderDetail`; writing renders it only as the
// fallback for an anonymous code (which has no savers). The count label
// ("Conversations" vs "Discussions") comes from the module's labels. The table
// renders through the shared <ListTable>, so it keeps the list pages' recipes.
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

  const columns: ListColumn<Interaction>[] = [
    {
      header: "First message",
      kind: "time",
      render: (interaction) => <LocalTime seconds={seconds(interaction.firstAt)} />,
    },
    {
      header: "Last message",
      kind: "time",
      render: (interaction) => <LocalTime seconds={seconds(interaction.lastAt)} />,
    },
    // Per-student data exists only when the activity opted out of anonymity.
    ...(!entry.anonymous
      ? [
          {
            header: "Student",
            render: (interaction) => (
              <span
                className="block max-w-72 truncate font-mono text-[0.85em]"
                title={interaction.userId ?? undefined}
              >
                {interaction.userName ?? interaction.userId ?? "—"}
              </span>
            ),
          } satisfies ListColumn<Interaction>,
        ]
      : []),
    {
      header: "User messages",
      kind: "numeric",
      render: (interaction) => interaction.userMessageCount,
    },
    {
      header: "Actions",
      kind: "actions",
      srOnlyHeader: true,
      render: (interaction) => (
        <Link
          href={`/codes/${entry.code}/c/${interaction.threadId}`}
          className={buttonVariants({ variant: "outline", size: "sm" })}
        >
          View
        </Link>
      ),
    },
  ];

  return (
    <>
      <dl className="mb-6 flex flex-wrap gap-4">
        <StatTile label={countLabel} value={stats.conversations} />
        {!entry.anonymous ? <StatTile label="Students" value={stats.studentCount} /> : null}
      </dl>

      {stats.interactions.length === 0 ? (
        <p className="text-foreground/70">
          Nothing yet — a conversation counts once a student sends at least one message.
        </p>
      ) : (
        <ListTable
          rows={stats.interactions}
          getRowKey={(interaction) => interaction.threadId}
          columns={columns}
        />
      )}
    </>
  );
}
