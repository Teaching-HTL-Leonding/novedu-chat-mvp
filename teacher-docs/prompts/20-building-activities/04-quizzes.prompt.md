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
  Markers work the same way inside `discussion.instructions` (discussion-only steering).
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
- Before you share a quiz: after validating, the grading itself can be tested — the
  eval command replays a file of your own sample answers through the real grader and
  reports where the verdicts differ from what you expect. One or two sentences plus a
  link to the "Testing how a quiz grades" chapter; the mechanics live there, not here.
  Include eval in the chapter's keywords/related front matter so the feature is
  discoverable from this page.

Get right:
- A compound quiz uses its OWN settings (model, anonymity, shuffle, attempt length,
  `discussion.instructions`) for every question, including imported ones; everything
  else of an included file is ignored — in particular a chapter's own
  `discussion.instructions` never applies in the final quiz.
- `instructions` is the ONE exception, and it must NOT be described as "ignored":
  the chapter quiz's top-level `instructions:` text TRAVELS with its questions, but
  for GRADING only. Grading an imported question is ADDITIVE — the final quiz's own
  `instructions` apply first, then the chapter's on top. Say this explicitly, and say
  why it matters: a language/persona/safety rule in the final quiz's `instructions`
  also governs every imported question and can sit alongside a chapter rule, so avoid
  putting conflicting rules in the two. Do NOT claim an imported question is graded
  identically to how its chapter quiz grades it.
- The follow-up discussion always follows the final quiz's own `instructions` and
  `discussion.instructions` — no chapter text reaches the discussion chat, so put any
  guidance discussions need in the final quiz's file.
- `question_count` bounds one attempt only, in the student's browser: it is not a
  server-enforced exam limit, nothing stops a reload starting a fresh attempt, and a
  repeated question is simply graded again.
- Shuffle interplay: shuffle on + count below the pool = a random selection per
  attempt; shuffle off + count below the pool = the first N in authored order; count
  above the pool = the whole pool is covered before anything repeats, and with shuffle
  on the same question never appears twice in a row.
- A quiz's fragment markers live in its two host texts: the top-level `instructions:`
  field (shapes grading AND discussion alike) and `discussion.instructions`
  (discussion-only). Per-question `evaluation` stays plain text. There is no
  `fragments:` list and no priority; a fragment lands where its marker sits.
- The grading guide is server-only and never shown to students, so it can state the
  expected answer.
- Answers are open-ended; there is no multiple choice.
- Defaults worth stating: anonymous is on, shuffle is on, photo answers are off.
- Reuse real YAML from activities/examples/**.

Look: activities/quizzes/README.md, activities/examples/** (sorting-quiz).
