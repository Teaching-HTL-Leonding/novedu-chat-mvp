# Many activities: the activity registry

Output: teacher-docs/content/30-sharing-activities/08-activity-registry.md · order 8

Job: A teacher who keeps course material in a git repository with many activities (a
book, a course, a worksheet collection) and is tired of minting codes one at a time and
pasting them into chapters. After this chapter they can write a registry file, run one
command to get every code, commit the generated lock file, and reference activities by a
name they chose instead of by a code.

Cover:
- The problem first: with one or two activities, creating a code by hand is fine; with
  twenty it stops working. Nothing in the material says which code belongs to which
  activity file, and every new activity is the same manual ritual.
- The idea: one hand-written registry file lists every activity of the material under a
  short name you choose. One command reconciles it with the app and writes a second,
  generated file that maps your names to the codes. Both files live in the repository.
- The registry file, with a worked multi-module example (quizzes and a tutor): the
  base address, the four groups (quizzes, tutors, writing, coding) and which activity
  kind each one means, and what an entry may say (the file, an availability window, a
  note, a model override). Say plainly which of those are optional.
- The names: you pick them, they must be unique across the whole file, and lowercase
  letters, digits and hyphens only.
- Running the command, what its report says (reused, minted, failed), and the
  try-it-first option.
- The generated lock file: commit it, never edit it, it is rewritten every run.
- What happens on re-runs, which is the part teachers most need to trust: an activity
  whose file, window and model override are unchanged keeps its code, so re-running is
  routine and safe. Changing the window or the model override gives a NEW code, and the
  old one keeps working until deleted; changing only the note never changes the code.
  Removing an entry drops the name from the lock file and leaves the code alone.
- Using the lock file in the material, with the Quarto book as the worked example:
  register the lock file as metadata and let the shortcode look the name up, so
  chapters read like "welcome" instead of a ten-character code, and the build never
  needs the app.
- The everyday loop after the switch: write the activity, validate it, push it, add one
  line to the registry, run the command, commit both files.

Get right:
- This is a command-line feature; there is no registry page in the web app. Say so
  once, early, and link to "Creating a shared code" for the single-activity path.
- The command needs the teacher sign-in; point at the introduction chapter "The Novedu
  CLI and its AI skill" for what the CLI is and how to set it up, rather than
  repeating it.
- Codes are never edited or deleted by this feature; that is why a parameter change
  produces a new code. Link to "Deleting a code" for retiring the old one.
- The window rules and the both-or-nothing model override are the same ones the normal
  create path uses; link to "Time-limiting a code" and "Available AI models" instead of
  restating them.
- A single broken activity does not block the others; the run reports it and keeps
  going, and the material keeps the code it had before.
- Do not describe matching as a lookup by name: the app knows nothing about the
  registry, and the names live only in the two files in the repository.
- Use the Creative Coding book (rstropek/ddp-ts-p5-beginner-course, the TypeScript
  Playground course material with a quiz at the end of most chapters) as the
  real-world example.

Look: docs/registry.md (the format and what a run does), cli/README.md (`codes sync`).
