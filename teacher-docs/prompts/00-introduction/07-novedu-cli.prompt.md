# The Novedu CLI and its AI skill

Output: teacher-docs/content/00-introduction/07-novedu-cli.md · order 7

Job: A teacher who has met the four activity kinds and now wants the companion tool
that goes with them. After this chapter they know what the Novedu CLI is and why they
would reach for it, and they have installed (and can later update) the bundled AI
skill so their coding assistant can drive the CLI for them. Orientation plus a short
setup; the individual commands get their own chapters later.

Cover:
- What the CLI is: a small command-line companion for the app. Two jobs, checking
  activity files before students see them (and showing the exact prompt an activity
  produces), and doing teacher work from the terminal (codes, hosted files and images,
  student reports, testing a quiz's grading).
- Why it matters to a teacher who is not a programmer: it runs the same checks the app
  runs, so mistakes surface on their screen. Nothing to install permanently, it runs on
  demand with Node.js installed.
- The AI skill: a set of instructions that teaches an AI coding assistant how to use
  the CLI, so the teacher can ask in plain language instead of remembering commands.
  Installing the skill does not install the CLI itself.
- Installing it with the skills.sh command line tool: the verbatim add command against
  the public Novedu repository, what each part is for, where it lands, and what to do
  afterwards (commit it with the course material, start a fresh assistant session).
- Checking that it worked.
- Updating it later with the same tool, and reviewing the change before committing.
- Treat the installed skill as delivered material: don't hand-edit it, an update
  replaces it.

Get right:
- Project scope is the default and the right choice here. A global install belongs to
  one person's machine and is not shared with colleagues. Do not recommend --global.
- The repository exposes more than one skill, so the add command must name
  --skill novedu-tutor-cli.
- --agent takes the assistant's identifier (for example claude-code or codex); the tool
  supports many. Don't present one assistant as the only option, and don't invent
  identifiers.
- The two --yes flags do different jobs (one belongs to npx, one to the skills tool).
  Using @latest avoids a stale cached release.
- The update command names the skill and uses --project, otherwise it can update every
  skill or the wrong scope.
- No version numbers or release history for either tool. The app is under heavy
  development and a version is stale within weeks.
- Don't promise an exact installed file path: it differs per assistant. Describe the
  result (the skill's folder plus a lock file entry) instead.
- Keep the CLI part at overview level. Do not duplicate the validate, prompts, eval, or
  codes chapters; name what the CLI can do and let the later chapters teach the
  commands.

Look: cli/README.md (the two jobs and the npx invocation),
.agents/skills/novedu-tutor-cli/SKILL.md (what the skill covers),
teacher-docs/install-novedu-cli-skill.md (the verified skills.sh commands),
https://github.com/vercel-labs/skills#readme (flags and agent identifiers).
