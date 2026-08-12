# Publishing your YAML (GitHub or upload)

Output: teacher-docs/content/20-building-activities/01-handling-yaml.md · order 1

Job: A teacher with a finished activity file who needs Novedu to reach it. After this
chapter they know the two ways to publish it (a public GitHub URL, or uploading it in
the app), and that they can edit it later.

Cover:
- Why a URL: Novedu reads the activity from a public address, so the file has to be
  reachable.
- Option A, GitHub: put the file in a public repository and use its raw URL. Commit
  and push before you use it.
- Option B, upload in the app: use the Files page to create, validate, and save a file;
  the app then hosts and serves it. The list holds every teacher's files: filter by
  name/title/description or by **owner** — the dropdown starts on your own files,
  "All owners" widens it to everyone's, and "Clear" brings you back to yours.
- Editing later: both paths let you change the file, and the app reads the current
  published version.

Get right:
- The GitHub path serves the pushed version, not your local copy; push first.
- Uploaded files are validated when you save.
- A relative reference (for example a shared fragment library) resolves against the
  activity's own URL.
- A file's **owner** is whoever saved it LAST, not whoever created it — saving a
  colleague's file makes you its owner, and it moves out of their default list view
  into yours. Say this plainly; it is the one surprising thing about the column.

Look: docs/files.md (behaviour only), cli/README.md (the files commands),
activities/README.md.
