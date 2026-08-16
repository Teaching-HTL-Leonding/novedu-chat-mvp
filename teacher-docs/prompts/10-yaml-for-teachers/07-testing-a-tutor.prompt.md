# Testing how a tutor answers

Output: teacher-docs/content/10-yaml-for-teachers/07-testing-a-tutor.md · order 7

Job: A teacher who has written a tutor and wants evidence that it actually follows its own
rules — "never hand over the solution", "stay inside this chapter", "answer in German" —
before a class meets it, and after every edit to those rules. After this chapter they can
script a few conversations, check the file for free, run it against the real tutor, and
read the report that says where the tutor stepped out of line.

Cover:
- The idea, in the teacher's terms. A quiz eval (chapter 06) asks "did the AI mark this
  answer the way I would?". A tutor eval asks a different question, because a tutor answer
  has no right-or-wrong mark: "given this situation, what does my tutor say next, and does
  it obey the rules I wrote?". The teacher scripts a short conversation that ENDS on a
  student message, the real tutor answers that message, and a second AI checks the answer
  against the tutor's own instructions. Make the pay-off concrete: a rule like "never give
  the full solution" is easy to write and easy for a model to quietly break, and this is
  how you find out.
- One command, two kinds of file. The same eval command runs both; there is no flag to
  choose. A single line in the file, kind: tutor, is what decides, and one run may mix quiz
  and tutor files. Say this early so a teacher who read chapter 06 knows they are not
  learning a second tool.
- The file. A small YAML file kept next to the tutor and named after it (e.g.
  sorting-tutor.eval.yaml). Show a complete, realistic example against the sorting tutor
  from the sample activities: id, kind: tutor, target (a path relative to the eval file, or
  a web address), then conversations, each with an optional title, an optional
  grading_instructions, and the scripted conversation turns. Point at the editor schema
  modeline, as the other authoring chapters do.
- The three authoring rules, plainly: the teacher writes BOTH sides (a tutor: turn is what
  you pretend the tutor already said, so you can set up exactly the situation you want to
  test); the last turn must be a student: turn, because that is the message the real tutor
  answers; and the tutor generates exactly one response, which is the only thing checked.
  Mention that two student: turns in a row are fine, there is no forced alternation.
- Why there is no "expected answer" field, and why that is the point. A tutor response has
  no verdict, so instead the judge reads the generated response and holds it against the
  tutor's OWN system prompt. That is what makes the file so short: the rules are already
  written, in the tutor, and the teacher does not restate them. Name the four things the
  judge reports, in the teacher's words: the response breaks a rule the tutor's own
  instructions state (writes the whole solution, wanders off the topic, answers in the
  wrong language), the response breaks the expectations written for that one case, the
  response says something simply wrong about the subject, and the response quotes or
  reveals its own instructions. Say plainly that the judge is told NOT to grade teaching
  style: a response the teacher would have phrased differently is not a problem, only one
  that breaks a stated rule.
- grading_instructions, and where a rule belongs. Per-conversation expectations, in plain
  language, for the one thing THIS case is about ("the response must not contain a complete
  working loop"). Course-wide rules belong in the tutor's own instructions, where they are
  checked automatically for every case; do not restate them per case.
- Did the tutor use its tool? A conversation may list the built-in tools (the ones the
  tutor file grants it) that the generated answer must have called at least once. Explain
  it in the teacher's terms: this is the one thing the judge cannot see, because a tool call
  leaves no trace in the answer text, so it is checked directly instead. Say that it means
  "called at least once", that calling other tools as well is fine, that a name the tutor
  was not given makes the file invalid when they check it (free, before any AI call), and
  that a missing tool call is REPORTED and never fails the run, like everything else a
  tutor eval finds. Mention that the run's missing-tool-calls line appears only when some
  case asked for a tool at all, so no line means nothing was checked rather than "all
  fine", and that the Markdown report names which run of which case skipped the tool and
  what it called instead. Keep it short and practical: use it where the tool IS the point
  (a practice number that must be drawn), and keep everything else in the case's
  expectations.
- The two commands: checking the file (free, offline, no sign-in, and it checks the tutor
  it points at too), then running it (this one really calls the AI, so the teacher must be
  signed in). Quote them verbatim.
- Reading a tutor run. Quote a real run. Explain the counts in the teacher's words: ok
  means the tutor answered, errored means the call itself never succeeded (server or
  network trouble, not the tutor's fault), skipped means the run stopped before reaching
  the case. Then the two note-only numbers, flagged responses and missing tool calls. Be
  very clear that neither one can fail a run: a tutor eval only exits non-zero when
  something went genuinely wrong with the RUN itself.
- The report is the deliverable. Because nothing gates, the terminal counts only tell the
  teacher how much to read; the Markdown report is where the actual findings live. Quote
  the flag verbatim and show a real excerpt: a flagged case with the scripted conversation,
  the expectations, the response the tutor actually generated, and what the judge objected
  to. Say that clean conversations are deliberately left out, so a good run gives a short
  file.
- Writing cases that are worth running. This is the most useful advice in the chapter, so
  give it room: read your own tutor instructions first, pick the rules that can actually be
  checked from a single answer, and script the situation that TEMPTS the model to break
  each one. "Just fix it for me" against a never-solve rule. An off-topic question against
  a topic rule. A question in the wrong language against a language rule. Say plainly that
  a conversation no rule speaks to teaches nothing, however realistic it looks.
- The shared options, briefly, pointing at chapter 06 rather than repeating it: repeats,
  turning the judge off, giving the judge a stronger model, a folder at once, and the token
  totals all work exactly as they do for a quiz eval.
- The bundled AI skill: the teacher can ask it to read their tutor, script the
  conversations, run the eval, and explain what the judge flagged, instead of typing flags.
  Don't explain what the skill is or how to install it, that's the introduction chapter
  "The Novedu CLI and its AI skill"; point at it instead.

Get right:
- Scripted conversations are the teacher's own invention. Never paste a real student's
  chat into an eval file. Say this plainly, once.
- Nothing gates. A flagged response and a missing tool call are both notes. The exit code
  reflects run health only: an invalid file, a call that errored, a case the run never
  reached. Do not let the chapter suggest a tutor eval can fail because the judge objected.
- Running an eval really calls the AI and therefore costs usage; checking the file does
  not. Show the run's own "N conversation(s) × R repeat(s) = M generation calls" line as
  the way to see the size before it starts.
- A passing run certifies the file on the teacher's own machine. If the tutor is hosted in
  the app, the same file still has to be uploaded afterwards, or the shared code keeps
  serving the old instructions. Give this its own short paragraph.
- Nothing is stored: no eval file, no scripted conversation, no generated response and no
  judgment is saved anywhere.
- An eval file is not an activity: it never gets a code and students never see it.
- A tutor eval has no marks, so it has no passed/failed counts, no confusion table, no
  false-correct rate and no "unstable" line. Where a report shows a column that only makes
  sense for a quiz, it shows a dash rather than a zero, because "no such measurement" must
  not read as "measured zero". Mention this once, at the report, and do not dwell on it.
- required_tools names must be tools the TARGET tutor grants in its own tools: list.
- Exit code 0 / 1 belongs in one sentence at most (a teacher may use it in a script); do
  not turn the chapter into a CI guide.
- No version history and no version floors. The app is under heavy development, so a
  version number is stale within weeks. Describe how the command behaves now and leave
  release history out of the chapter entirely.
- Use verbatim commands and real report output, not invented ones.

Look: the "Tutor evals" section of activities/evals/README.md, activities/tutors/README.md
(the tools section and the instructions it shows), cli/README.md (the eval section),
.agents/skills/novedu-tutor-cli/SKILL.md and its eval reference, docs/cli-eval.md
(teacher-facing behavior only — the endpoints, retry policy and metering internals are out
of scope), activities/examples/sorting-algorithms/** for the sample tutor.
