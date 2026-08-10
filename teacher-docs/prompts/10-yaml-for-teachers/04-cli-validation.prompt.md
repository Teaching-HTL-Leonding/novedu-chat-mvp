# Validating with the CLI

Output: teacher-docs/content/10-yaml-for-teachers/04-cli-validation.md · order 4

Job: A teacher who wants to check an activity before sharing it. After this chapter
they can run the validate command with the right kind, read a pass or fail result, and
know they can ask the bundled AI skill for help with an error.

Cover:
- What validation does and why: it runs the same checks the app runs, so problems show
  up before students do.
- The command: the validate command with a file path or URL, and the --kind option
  (tutor is the default; fragment, quiz, writing, coding, and eval are the others).
  Quote the real commands. Mention eval only in passing here — it validates a
  golden-answer file for a quiz's grading and gets its own chapter (06).
- Reading the result: success versus a failure that names the specific problem.
- The bundled AI skill: teachers can ask it to run validation and explain an error.
  Keep it to what the assistant does for validation and point at the introduction
  chapter "The Novedu CLI and its AI skill" for installing the skill.

Get right:
- What the CLI is in general, and how to install the AI skill, belong to the
  introduction chapter "The Novedu CLI and its AI skill". Don't repeat either here:
  one line that the CLI runs on demand with npx is enough.
- --kind is required for everything except a tutor; leaving it off validates the file
  as a tutor and fails confusingly.
- Validating a URL checks the published file, so commit and push first.
- No version history and no version floors. The app is under heavy development, so a
  version number is stale within weeks. Describe how the command behaves now and leave
  release history out of the chapter entirely.
- Use verbatim commands from cli/README.md, not invented ones.

Look: cli/README.md, .agents/skills/novedu-tutor-cli/SKILL.md.
