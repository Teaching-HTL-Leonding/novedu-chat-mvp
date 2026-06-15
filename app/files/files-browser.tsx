"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { CopyIconButton } from "@/components/copy-icon-button";
import { EditIcon, ExternalLinkIcon, ShareIcon } from "@/components/icons";
import { filePublicUrl } from "@/lib/file-url";
import { LocalTime } from "../local-time";
import { DeleteFileButton } from "./delete-file-button";
import styles from "./files.module.css";

// One active file as shown in the list (no content). `updatedSeconds` is the
// active version's write time as unix seconds (the server converts from the
// stored Date so LocalTime can render it in the viewer's zone); `createdBy` is
// the last writer's oid, used by the "Only my files" filter.
export interface FileRow {
  id: string;
  name: string;
  kind: string;
  title: string | null;
  description: string | null;
  updatedSeconds: number;
  createdBy: string;
}

// Teacher-facing list of app-hosted YAML files with a contains-filter over
// name/title/description and an "Only my files" toggle (both applied in memory —
// the list is small and already loaded). Each row's Copy URL hands over the
// public GET URL that drops into a tutor code; tutor files also offer a one-click
// "Create tutor code" deep link.
export function FilesBrowser({
  origin,
  rows,
  currentUserId,
}: {
  origin: string;
  rows: FileRow[];
  currentUserId: string;
}) {
  const [query, setQuery] = useState("");
  // Default to the teacher's OWN files — the common case is managing what you
  // authored; untick to browse everyone's.
  const [onlyMine, setOnlyMine] = useState(true);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((row) => {
      if (onlyMine && row.createdBy !== currentUserId) return false;
      if (!q) return true;
      const haystack = `${row.name} ${row.title ?? ""} ${row.description ?? ""}`.toLowerCase();
      return haystack.includes(q);
    });
  }, [rows, query, onlyMine, currentUserId]);

  // Absolute URL when the server resolved an origin; relative as a last resort.
  const fileUrl = (name: string) => filePublicUrl(origin, name);

  return (
    <div className={styles.container}>
      <p className={styles.hint}>
        App-hosted YAML files. Copy a file's public URL and paste it into a tutor code (tutor files
        offer a one-click shortcut). Every save is validated; an invalid file is rejected.
      </p>

      <div className={styles.toolbar}>
        <Link href="/files/new" className={styles.button}>
          New file
        </Link>
        <div className={styles.filters}>
          <input
            type="search"
            className={styles.searchInput}
            placeholder="Filter by name, title, description…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            aria-label="Filter files"
          />
          <label className={styles.onlyMine}>
            <input
              type="checkbox"
              checked={onlyMine}
              onChange={(event) => setOnlyMine(event.target.checked)}
            />
            Only my files
          </label>
        </div>
      </div>

      {rows.length === 0 ? (
        <p className={styles.empty}>
          No files yet. <Link href="/files/new">Create one</Link> to host a tutor or fragment YAML.
        </p>
      ) : filtered.length === 0 ? (
        <p className={styles.empty}>No files match your filter.</p>
      ) : (
        <table className={styles.table}>
          <thead>
            <tr>
              <th scope="col">Name</th>
              <th scope="col">Kind</th>
              <th scope="col">Title</th>
              <th scope="col">Last updated</th>
              <th scope="col" className={styles.actionsHeader}>
                <span className={styles.visuallyHidden}>Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((row) => {
              const url = fileUrl(row.name);
              const isTutor = row.kind === "tutor";
              return (
                <tr key={row.id}>
                  <td className={styles.nameCell}>{row.name}</td>
                  <td>
                    <span
                      className={`${styles.kindBadge} ${isTutor ? styles.kindTutor : styles.kindFragment}`}
                    >
                      {row.kind}
                    </span>
                  </td>
                  <td className={styles.titleCell} title={row.description ?? undefined}>
                    {row.title ?? "—"}
                  </td>
                  <td className={styles.timeCell}>
                    <LocalTime seconds={row.updatedSeconds} />
                  </td>
                  <td className={styles.actionsCell}>
                    <CopyIconButton
                      text={url}
                      label="Copy URL"
                      className={styles.iconButton}
                      promptLabel="Copy the file URL:"
                    />
                    <a
                      href={url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={styles.iconButton}
                      aria-label="Open raw YAML"
                      title="Open raw YAML"
                    >
                      <ExternalLinkIcon />
                    </a>
                    {isTutor ? (
                      <Link
                        href={`/share-tutor?tutor=${encodeURIComponent(url)}`}
                        className={styles.iconButton}
                        aria-label="Create tutor code"
                        title="Create tutor code"
                      >
                        <ShareIcon />
                      </Link>
                    ) : null}
                    <Link
                      href={`/files/edit/${row.name}`}
                      className={styles.iconButton}
                      aria-label={`Edit ${row.name}`}
                      title="Edit"
                    >
                      <EditIcon />
                    </Link>
                    <DeleteFileButton name={row.name} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
