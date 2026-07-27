"use client";

import { useRouter } from "next/navigation";
import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useMemo,
  useState,
  useTransition,
} from "react";
import { CheckSquareIcon, SquareIcon, TrashIcon } from "@/components/icons";
import { Spinner } from "@/components/spinner";
import { Button } from "@/components/ui/button";
import { FieldError } from "@/components/ui/field";

// The SHARED multi-delete layer for "filtered list" pages (see
// docs/filtered-lists.md). A list opts in by wrapping its <DataList> in
// <SelectionProvider> (giving it the visible rows' keys), adding the leading
// selection column (`selectionColumn`, in the server-safe sibling module), and
// dropping a <DeleteSelectedButton> in the toolbar next to "New …". The provider
// owns the selected-id set + the in-flight `pending` flag; the button runs a
// per-list server action over the selected ids in ONE call — the action loops the
// store's per-item delete helper, so it is the single delete path (see AGENTS.md).
//
// The selection "id" is whatever the delete action expects (a file NAME, a tutor
// CODE) — not necessarily the DataList React key. The provider's `allIds` and the
// selection column's `getRowKey` must use that SAME key.

// The minimal contract a list's bulk-delete server action must satisfy. The real
// actions return a richer `{ ok: true; deleted } | { ok: false; message }`, which
// is assignable to this.
export type BulkDeleteResult = { ok: boolean; message?: string };
export type BulkDeleteAction = (ids: string[]) => Promise<BulkDeleteResult>;

interface SelectionContextValue {
  isSelected: (id: string) => boolean;
  toggle: (id: string) => void;
  selectAll: () => void;
  clear: () => void;
  selectedIds: string[];
  selectedCount: number;
  pending: boolean;
  runDelete: (action: BulkDeleteAction) => Promise<BulkDeleteResult>;
}

const SelectionContext = createContext<SelectionContextValue | null>(null);

function useSelection(): SelectionContextValue {
  const ctx = useContext(SelectionContext);
  if (!ctx) throw new Error("useSelection must be used within a SelectionProvider");
  return ctx;
}

export function SelectionProvider({ allIds, children }: { allIds: string[]; children: ReactNode }) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [pending, startTransition] = useTransition();

  // A stable signature of the visible set, so the prune effect only runs when the
  // rows actually change (each render passes a fresh `allIds` array). The join uses
  // a NUL separator (not a space) so the signature can't collide for two different
  // id sets regardless of what a future list's selection keys contain — keep it NUL
  // (written as the unicode escape, so the source file stays plain text in git).
  const allKey = allIds.join("\u0000");

  // Drop selections that left the visible set (a filter was applied, or rows were
  // deleted) so the count and the delete payload never carry hidden rows.
  // biome-ignore lint/correctness/useExhaustiveDependencies: allIds is captured by allKey
  useEffect(() => {
    setSelected((prev) => {
      if (prev.size === 0) return prev;
      const allowed = new Set(allIds);
      const next = new Set<string>();
      for (const id of prev) if (allowed.has(id)) next.add(id);
      return next.size === prev.size ? prev : next;
    });
  }, [allKey]);

  const selectedIds = useMemo(() => Array.from(selected), [selected]);

  const value: SelectionContextValue = {
    isSelected: (id) => selected.has(id),
    toggle: (id) =>
      setSelected((prev) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      }),
    selectAll: () => setSelected(new Set(allIds)),
    clear: () => setSelected(new Set()),
    selectedIds,
    selectedCount: selectedIds.length,
    pending,
    runDelete: (action) =>
      new Promise<BulkDeleteResult>((resolve) => {
        startTransition(async () => {
          const result = await action(Array.from(selected));
          if (result.ok) {
            setSelected(new Set());
            router.refresh();
          }
          resolve(result);
        });
      }),
  };

  return <SelectionContext.Provider value={value}>{children}</SelectionContext.Provider>;
}

/** One row's selection checkbox. `label` only sharpens the accessible name. */
export function RowSelectCheckbox({ id, label }: { id: string; label?: string }) {
  const { isSelected, toggle, pending } = useSelection();
  return (
    <input
      type="checkbox"
      className="size-4 cursor-pointer accent-foreground disabled:cursor-default"
      checked={isSelected(id)}
      onChange={() => toggle(id)}
      disabled={pending}
      aria-label={label ? `Select ${label}` : "Select row"}
    />
  );
}

// The bare square icon buttons in the selection header — deliberately smaller
// and borderless (they sit inside a table header, not a toolbar).
const SELECT_ICON_BUTTON =
  "inline-flex size-6 cursor-pointer items-center justify-center rounded-md text-foreground/65 not-disabled:hover:bg-foreground/10 not-disabled:hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50 [&_svg]:size-4";

/** The header cell's select-all / unselect-all icon buttons. */
export function SelectAllControls() {
  const { selectAll, clear, pending } = useSelection();
  return (
    <span className="inline-flex items-center gap-1">
      <button
        type="button"
        className={SELECT_ICON_BUTTON}
        onClick={selectAll}
        disabled={pending}
        aria-label="Select all rows"
        title="Select all"
      >
        <CheckSquareIcon />
      </button>
      <button
        type="button"
        className={SELECT_ICON_BUTTON}
        onClick={clear}
        disabled={pending}
        aria-label="Unselect all rows"
        title="Unselect all"
      >
        <SquareIcon />
      </button>
    </span>
  );
}

/**
 * The toolbar "Delete Selected" button (red, border only). Disabled until ≥1 row
 * is selected; confirms with the count, then runs the list's bulk action in one
 * call and shows the shared Spinner while it's in flight. On failure it surfaces
 * the action's message inline and KEEPS the selection so the teacher can retry.
 */
export function DeleteSelectedButton({
  action,
  itemNoun,
}: {
  action: BulkDeleteAction;
  itemNoun: string;
}) {
  const { selectedCount, pending, runDelete } = useSelection();
  const [error, setError] = useState<string | null>(null);

  async function onDelete() {
    if (selectedCount === 0) return;
    const noun = selectedCount === 1 ? itemNoun : `${itemNoun}s`;
    const confirmed = window.confirm(
      `Delete ${selectedCount} ${noun}?\n\nThis permanently deletes them and cannot be undone.`,
    );
    if (!confirmed) return;
    setError(null);
    const result = await runDelete(action);
    if (!result.ok) {
      setError(result.message ?? "Some items could not be deleted. Try again.");
    }
  }

  return (
    <>
      <Button
        variant="destructiveOutline"
        onClick={onDelete}
        disabled={selectedCount === 0 || pending}
        aria-label={
          pending
            ? `Deleting ${selectedCount} selected…`
            : selectedCount > 0
              ? `Delete ${selectedCount} selected`
              : "Delete selected"
        }
      >
        {pending ? (
          <>
            <Spinner /> Deleting…
          </>
        ) : (
          <>
            <TrashIcon /> Delete Selected{selectedCount > 0 ? ` (${selectedCount})` : ""}
          </>
        )}
      </Button>
      {error ? <FieldError>{error}</FieldError> : null}
    </>
  );
}

/**
 * A generic toolbar bulk-action button for the shared selection layer — the same
 * disabled-until-selection / pending-Spinner / FieldError-on-failure behavior as
 * `DeleteSelectedButton`, but for any non-delete bulk action (e.g. the reports
 * inbox's "Mark resolved" / "Reopen"). It reuses the provider's existing
 * `runDelete` machinery (which clears the selection + `router.refresh()`es on
 * success), so a successful action behaves identically to a bulk delete.
 *
 * `confirmMessage` is optional: when given, it must return the `window.confirm`
 * text for the current count (a destructive action passes one); when omitted the
 * action runs immediately with no confirm (mark-resolved / reopen need none).
 */
export function BulkActionButton({
  action,
  label,
  pendingLabel,
  icon,
  variant = "outline",
  confirmMessage,
}: {
  action: BulkDeleteAction;
  label: string;
  pendingLabel: string;
  icon?: ReactNode;
  variant?: "outline" | "destructiveOutline";
  confirmMessage?: (count: number) => string;
}) {
  const { selectedCount, pending, runDelete } = useSelection();
  const [error, setError] = useState<string | null>(null);

  async function onClick() {
    if (selectedCount === 0) return;
    if (confirmMessage && !window.confirm(confirmMessage(selectedCount))) return;
    setError(null);
    const result = await runDelete(action);
    if (!result.ok) {
      setError(result.message ?? "The action could not be completed. Try again.");
    }
  }

  return (
    <>
      <Button
        variant={variant}
        onClick={onClick}
        disabled={selectedCount === 0 || pending}
        aria-label={
          pending
            ? `${pendingLabel} ${selectedCount} selected…`
            : selectedCount > 0
              ? `${label} ${selectedCount} selected`
              : label
        }
      >
        {pending ? (
          <>
            <Spinner /> {pendingLabel}…
          </>
        ) : (
          <>
            {icon}
            {label}
            {selectedCount > 0 ? ` (${selectedCount})` : ""}
          </>
        )}
      </Button>
      {error ? <FieldError>{error}</FieldError> : null}
    </>
  );
}
