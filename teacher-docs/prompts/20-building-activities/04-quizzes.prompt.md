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
- Reusing fragments: a quiz can pull in shared prompt fragments via a top-level
  `fragment_files:` / `fragments:` block; they apply to both grading and the follow-up
  discussion. Short section; the reusable-fragments chapter has the detail.

Get right:
- Fragments come before the quiz's own text, and they shape grading AND discussion
  alike.
- The grading guide is server-only and never shown to students, so it can state the
  expected answer.
- Answers are open-ended; there is no multiple choice.
- Defaults worth stating: anonymous is on, shuffle is on, photo answers are off.
- Reuse real YAML from activities/examples/**.

Look: activities/quizzes/README.md, activities/examples/** (sorting-quiz).
