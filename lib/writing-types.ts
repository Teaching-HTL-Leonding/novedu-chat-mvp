// Client-safe writing types — the student-facing projection of a writing YAML.
// PURE — no I/O, no YAML parser, no server-only imports — so a client component
// (the writing surface) can import the public shape without pulling the parser or
// the teacher's `instructions` into the browser bundle. The richer, server-only
// types and the lenient parser live in `lib/writing-yaml.ts`.

/**
 * The student-facing projection of a writing activity — everything the editor +
 * welcome screen need, nothing more. Crucially it DROPS the teacher's
 * `instructions` and the `model`, which stay server-side.
 */
export interface WritingPublic {
  /** Optional welcome-screen heading. */
  title?: string;
  /** Optional welcome-screen description (markdown). */
  description?: string;
  /** Optional starter text prefilled into the editor. */
  placeholder?: string;
}
