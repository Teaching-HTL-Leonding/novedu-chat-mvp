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

Get right:
- A quiz's fragment markers live in a top-level `instructions:` field (separate from
  `discussion.instructions`), and that text shapes grading AND discussion alike. There
  is no `fragments:` list and no priority; a fragment lands where its marker sits.
- The grading guide is server-only and never shown to students, so it can state the
  expected answer.
- Answers are open-ended; there is no multiple choice.
- Defaults worth stating: anonymous is on, shuffle is on, photo answers are off.
- Reuse real YAML from activities/examples/**.

Look: activities/quizzes/README.md, activities/examples/** (sorting-quiz).
