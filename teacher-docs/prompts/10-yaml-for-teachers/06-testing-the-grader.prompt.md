# Testing how a quiz grades

Output: teacher-docs/content/10-yaml-for-teachers/06-testing-the-grader.md · order 6

Job: A teacher who has written a quiz and wants to know whether its grading criteria
actually behave the way they intended — before a class meets it, and after every edit
to those criteria. After this chapter they can write a small golden-answer file, check
it for free, run it against the real grader, read the report, and act on what it says.

Cover:
- The idea, in the teacher's terms. Validation says the quiz file is well-formed; the
  prompt dump (chapter 05) says what the AI is told. This chapter closes the loop: it
  says what the AI actually DOES. The teacher writes a handful of student answers
  themselves — a good one, a half one, a confidently wrong one — writes down the mark
  each one should get, and the command grades them with the same grader students meet.
  This is what "evaluation" means in practice, and it turns "the AI feels too lenient"
  into a number.
- The file. A small YAML file kept next to the quiz, named after it (e.g.
  my-quiz.eval.yaml). Show a complete, realistic example: id, target (a path relative
  to the eval file, or a URL), then questions, each naming a question id of the quiz
  and carrying its answers, each answer with expect and answer. Explain that expect is
  correct, partial or incorrect — or a LIST of the ones you would accept, for an answer
  where more than one mark is defensible. Point at the editor schema modeline, as the
  other authoring chapters do.
- The two commands: checking the file (free, offline, no sign-in — and it checks the
  quiz it points at too), then running it (this one really calls the AI, so the teacher
  must be signed in). Quote them verbatim.
- Reading the report. Quote a real run. Explain, in this order: passed / failed /
  errored counts; the mismatch lines that name the question, the expected mark, the
  mark the AI gave and a snippet of the answer; the confusion matrix as "what I
  expected versus what it said"; and the false-correct rate — answers the teacher
  marked as not acceptable that the grader nevertheless called correct. Say plainly
  that the false-correct number is usually the one worth acting on, and that the fix is
  a sharper "grade incorrect when …" sentence in the quiz's evaluation criteria.
- Checking the WORDING, not just the mark. A student never sees the mark alone — they
  read the feedback sentence the AI wrote, and that sentence can be wrong while the mark
  is right. So every run also has a second AI, a judge, read each piece of feedback and
  check it against the grading instructions the grader itself was given. Make the point
  that this needs NO extra authoring: the teacher's own evaluation criteria and shared
  instructions already say what good feedback looks like, and the judge simply holds the
  feedback to them. Name the four things it reports, in the teacher's words: feedback
  that contradicts the mark (praise on a wrong answer, or the reverse), feedback that
  states something the criteria contradict, feedback that breaks a rule the instructions
  gave (most often: not naming the correct answer when the mark is not "correct", or
  writing in the wrong language), and feedback that quotes the grading criteria at the
  student. Say plainly that a flag NEVER fails a run — it is a note about wording, and
  the fix is usually one sentence in the evaluation criteria or the shared instructions,
  not a change to the golden answers. Then the two flags, verbatim: the one that turns
  judging off (halves what a run costs, good for a quick check) and the pair that gives
  the judge a different, stronger model than the grader (recommended, always both
  together). Mention that judging is on by default and roughly doubles the number of AI
  calls — which is what the run's own scope line shows — and that if the judge model
  itself keeps failing, judging stops after a few failures while the grading finishes
  normally, so a zero in the flagged column then means "not checked", not "all fine".
- Tutor evals only: did the tutor actually use its tool? A conversation may list the
  built-in tools (the ones the tutor file grants it) that the generated answer must have
  called at least once. Explain it in the teacher's terms: this is the one thing the
  judge cannot see, because a tool call leaves no trace in the answer text — so it is
  checked directly instead. Say that it means "called at least once", that calling other
  tools as well is fine, that a name the tutor was not given makes the file invalid when
  they check it (free, before any AI call), and that a missing tool call is REPORTED and
  never fails the run, like everything else a tutor eval finds. Mention that the run's
  missing-tool-calls line appears only when some case asked for a tool at all, so no line
  means nothing was checked rather than "all fine", and that the Markdown report names
  which run of which case skipped the tool and what it called instead. Keep it short and
  practical: use it where the tool IS the point (a practice number that must be drawn),
  and keep everything else in the case's expectations.
- Is the grader consistent? The repeats option grades every answer several times and
  takes the majority, so one flaky run does not fail a case; answers whose runs
  disagreed are reported as "unstable". Explain why that matters pedagogically: a
  criterion that decides the same answer differently on different runs will do the same
  to two students who wrote the same thing. Mention that repeats multiply the cost.
- Trying a different AI model. The two model flags (always together) grade the same
  golden answers with another model, so a teacher can compare reports before switching
  a quiz over. Say clearly that this changes only the run, not the quiz and not any
  code already handed out.
- Several files at once, briefly: a folder of eval files in one run, with a per-file
  summary and totals, and a broken file reported rather than aborting the rest.
- Keeping a readable report. The report flag writes the run as a Markdown file: an
  overview table first (one row per file with the counts, the flagged-feedback count,
  the false-correct rate and
  the token spend), then details only for the answers that need attention — the
  question, the teacher's golden answer and the grader's feedback, side by side —
  followed by a separate "Flagged feedback" section listing what the judge objected to
  (those answers usually passed; it is the wording that needs work).
  Passing, unflagged answers stay out of the details on purpose. The file is plain Markdown: it
  reads well in an editor preview, renders on GitHub, and can be kept next to the quiz
  or sent to a colleague. Quote the flag verbatim and show a small excerpt of a real
  report (the overview table and one mismatch section is enough).
- What a run costs. The run summary and the report both show the token totals of the
  run (input, cached input, output), so a teacher can see what an eval spent and
  roughly compare the cost of two models. Keep it to a short paragraph; one honest
  clause that the count covers the calls that succeeded is enough.
- The bundled AI skill: the teacher can ask it to write the golden answers, run the
  eval, and explain the mismatches, instead of typing flags. Don't explain what the
  skill is or how to install it, that's the introduction chapter "The Novedu CLI and
  its AI skill"; point at it instead.
- A short "how many answers" paragraph of practical advice: three or four per question
  you care about is already useful; you do not need to cover every question; the
  confidently-wrong answers are the ones that find a lenient rubric.

Get right:
- Golden answers are the teacher's own invented examples. Never paste a real student's
  answer into an eval file. Say this plainly, once.
- Running an eval really calls the AI and therefore costs usage; checking the file does
  not. Show the run's own "N cases × R repeats = M grading calls" line as the way to
  see the size before it starts.
- A passing run certifies the file on the teacher's own machine. If the quiz is hosted
  in the app, the same file still has to be uploaded afterwards, or the shared code
  keeps serving the old criteria. This is the single most important caveat — give it
  its own short paragraph.
- Question ids must match the quiz. For a quiz assembled from other quiz files, the
  ids carry the alias prefix; point at the prompt-dump command as the way to list the
  real ids.
- Running a whole course at once takes real time and is all-or-nothing. Warn that it
  can take up to several hours, but never state a rate, a per-answer time or a total:
  speed depends on the model and how busy it is, it changes over time, and a concrete
  number would read as a promise. Say that the counter animates only while they watch a
  terminal, and that a run whose output goes to a file reports one line per finished
  file instead, and that the report is written only at the very end — an interrupted run
  saves nothing. The practical advice is to
  run one folder at a time with its own report file. Keep this short and reassuring;
  it belongs with the whole-folder section, not up front.
- The pass/fail counting is per ANSWER (one golden answer = one case), and with repeats
  the majority decides — so asking for repeats never makes the check stricter.
  "Unstable" is information, not a failure.
- Nothing is stored: no eval file, no answer, no mark and no judgment is saved anywhere.
- Flagged feedback is reported, never a failure. Do not let the chapter suggest a run
  can fail because of it, and do not present the judge as a second opinion on the MARK —
  it only ever looks at the wording.
- An eval file is not an activity: it never gets a code and students never see it.
- Photo answers cannot be evaluated yet; evals are text only.
- Exit code 0 / 1 belongs in one sentence at most (a teacher may use it in a script);
  do not turn the chapter into a CI guide.
- No version history and no version floors. The app is under heavy development, so a
  version number is stale within weeks. Describe how the command behaves now and leave
  release history out of the chapter entirely.
- Use verbatim commands and real report output, not invented ones.

Look: activities/evals/README.md, the "Testing the grading itself" section of
activities/quizzes/README.md, cli/README.md (the eval section),
.agents/skills/novedu-tutor-cli/SKILL.md, docs/cli-eval.md (teacher-facing behavior
only — the endpoint, retry policy and metering internals are out of scope).
