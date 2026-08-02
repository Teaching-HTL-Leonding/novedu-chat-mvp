# Building a quiz

Output: teacher-docs/content/20-building-activities/04-quizzes.md · order 4

Job: A teacher writing a quiz file. After this chapter they know how to write
question-and-grading pairs and set the common options, working from a real example.

Cover:
- The core: an id, a model, and a list of questions; each question has the text
  students see and a separate grading guide the AI uses.
- Writing good grading guidance: name the correct, partial, and incorrect outcomes so
  the AI maps a student's answer onto one of them.
- Options: shuffling the order, letting students attach a photo of their work (needs a
  vision-capable model), and an optional follow-up discussion.
- Walk a real example (the sorting-algorithms sample quiz).
- Reusing fragments: a quiz declares libraries under a top-level `fragment_files:` and
  places fragments with inline `{{fragment "alias.id" …}}` markers in a top-level
  `instructions:` field; that text applies to both grading and the follow-up discussion.
  Short section; the reusable-fragments chapter has the detail.
- Compound quizzes (`quiz_files`): build a final/overall quiz that asks the questions
  of several chapter quizzes by referencing their files (alias + URL). All questions of
  every referenced quiz are included, live: editing a chapter quiz immediately updates
  the final quiz, no copy-paste. Alias naming (short, no dot, no slash; it prefixes the
  imported question ids in the statistics), one level only (an included quiz may not
  include further quizzes), a compound quiz may have no questions of its own.
- Attempt length (`question_count`): cap how many questions one attempt asks (useful
  when the pool is large), or set it above the pool size for drill/practice mode where
  questions repeat. Explain the shuffle interplay in teacher terms.

Get right:
- A compound quiz uses its OWN settings (model, anonymity, shuffle, discussion text,
  attempt length) for every question, including imported ones; the one thing that
  travels with an imported question is its source quiz's top-level `instructions:`
  text, so grading stays consistent with the chapter quiz. Everything else of an
  included file is ignored.
- `question_count` bounds one attempt only, in the student's browser: it is not a
  server-enforced exam limit, nothing stops a reload starting a fresh attempt, and a
  repeated question is simply graded again.
- Shuffle interplay: shuffle on + count below the pool = a random selection per
  attempt; shuffle off + count below the pool = the first N in authored order; count
  above the pool = the whole pool is covered before anything repeats, and with shuffle
  on the same question never appears twice in a row.
- A quiz's fragment markers live in a top-level `instructions:` field (separate from
  `discussion.instructions`), and that text shapes grading AND discussion alike. There
  is no `fragments:` list and no priority; a fragment lands where its marker sits.
- The grading guide is server-only and never shown to students, so it can state the
  expected answer.
- Answers are open-ended; there is no multiple choice.
- Defaults worth stating: anonymous is on, shuffle is on, photo answers are off.
- Reuse real YAML from activities/examples/**.

Look: activities/quizzes/README.md, activities/examples/** (sorting-quiz).
