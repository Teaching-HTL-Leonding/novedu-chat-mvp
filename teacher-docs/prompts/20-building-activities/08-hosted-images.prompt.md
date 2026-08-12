# Hosting images

Output: teacher-docs/content/20-building-activities/08-hosted-images.md · order 8

Job: A teacher who wants a picture in an activity — a diagram in a quiz question,
an illustration in a tutor — without running their own image hosting. After this
chapter they know how to upload an image in the app (or with the CLI), how to
reference it from activity YAML by name, and what the rules are.

Cover:
- Why host in the app: the image gets a stable name, needs no public web server,
  and stays available to every activity that references it.
- Uploading in the app: the Images page — pick a name, pick the file, optionally
  add a credit/attribution line; the image appears in your list. The list holds every
  teacher's images: filter by name or by **owner** — the dropdown starts on your own
  images, "All owners" widens it to everyone's, and "Clear" brings you back to yours.
- Uploading with the CLI: `images upload <name> --file <path> [--credit <text>]`
  and `images list` — for teachers already working in the terminal or through a
  coding agent (cross-link the introduction chapter "The Novedu CLI and its AI skill"
  for the CLI itself; the images commands need a signed-in teacher).
- Referencing from YAML: by NAME with `hosted: true` (for example a quiz
  question's `image:` block with `src`, `hosted: true`, and an `alt` text) —
  never by pasting a download link.
- The rules: PNG, JPEG, or SVG; at most 5 MB; names use letters, digits,
  underscores, hyphens.
- Replacing an image: an image cannot be edited or overwritten — delete it in
  the app and upload the file again under the same name (the CLI cannot delete).
- The credit line: shown small under the image wherever it appears; good for
  license notices like "CC BY 4.0".

Get right:
- The reference in YAML is the image's *name*, not a URL; the download link the
  list shows is temporary and must not be pasted into an activity.
- Uploading is create-only: a name that is already taken is rejected, whether in
  the app or the CLI.
- Alt text lives in the YAML reference, not on the uploaded image.
- An image's **owner** is whoever saved it last (the same rule as hosted files);
  cross-link "Publishing your YAML" rather than re-explaining it at length.

Look: docs/images.md (behaviour only), cli/README.md (the images commands), the
image sections of activities/quizzes/README.md and activities/tutors/README.md.
