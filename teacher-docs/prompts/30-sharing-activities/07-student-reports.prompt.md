# Student reports

Output: teacher-docs/content/30-sharing-activities/07-student-reports.md · order 7

Job: A teacher who wants students to flag notable AI behavior — brilliant, wrong, or
inappropriate — and wants to review what comes in. After this chapter they know what
students can report and how, where reports arrive, and how to work through them.

Cover:
- What students see: a small "Report" button in every chat (tutor, quiz discussion,
  writing feedback) and next to every graded quiz answer. Reporting is two clicks: pick
  one of four reactions (good / OMG / bad / "Holy sh..", the last meaning "needs a
  teacher's attention now") and optionally add a short description.
- Reports are never anonymous — even on an anonymous code. The student is told this in
  the report form before sending; filing a report is their choice to be named.
- The Reports page: newest urgent reports first, filters for open vs. resolved,
  reaction, a text search, and "only my codes" (on by default). A chat report opens the
  conversation transcript; a quiz report opens a detail view with the question, the
  student's answer, and the AI's feedback exactly as the student saw them.
- Working the list: select reports and mark them resolved (or reopen them), and delete
  the ones you no longer need.
- Triaging reports from the command line, and letting an AI assistant do it: the Novedu
  CLI can list reports, show one report in full, and mark reports resolved, so a
  terminal-comfortable teacher (or an AI coding assistant working in a copy of the
  repository) can work through reports without the web page. Cover, using the real
  commands the source names: sign in first with the login command; the list command
  (same defaults as the page: open reports on your own codes, plus filters for status,
  reaction, and a search, and a switch to widen to every teacher's codes); the show
  command for one report by its id, which for a chat report also prints the whole
  conversation; and the resolve command that marks one or more reports resolved at once.
  The CLI's output is JSON, made for scripts and AI assistants rather than for reading
  by eye. The whole point of this is a fix-it loop an AI assistant can run for you: read
  a report, work out what went wrong, fix the activity file, publish the new version,
  then mark the report resolved. Cross-link the CLI-introducing chapter (Validating with
  the CLI) and publishing your YAML, rather than re-explaining login or upload here.

Get right:
- The four reactions include praise — reports are a feedback channel, not only a
  complaint channel; encourage classes to flag great answers too.
- A quiz report carries a copy of the answer and the AI feedback, because quiz answers
  are otherwise not stored; photos attached to an answer are noted but not kept.
- On an anonymous code a report names ONLY the reporting student, never anyone else,
  and the rest of the code's work stays anonymous.
- Deleting a code deletes its reports.
- Do not promise notifications; reports show up on the Reports page and nowhere else.
- The CLI can list, show, and resolve only. Reopening and deleting a report stay in the
  web Reports page on purpose, so an automated assistant can never delete a student's
  report; say this plainly.
- A resolve run from the CLI is recorded as done by whoever signed in, exactly like
  resolving on the page; it is not anonymous or system-attributed.
- Reports are filed only by students inside an activity; there is no way to create a
  report from the CLI, and the CLI never files one.
- Use only the CLI commands and flags the source actually names (docs/api.md,
  cli/README.md); do not invent command names, flags, or output shapes.

Look: docs/reports.md (behavior, including the "Bearer channel" section),
docs/api.md (the reports routes and CLI command group), cli/README.md (CLI framing,
login), docs/codes.md (anonymity background).
