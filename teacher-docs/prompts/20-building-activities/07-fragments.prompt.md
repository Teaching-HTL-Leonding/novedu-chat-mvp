# Reusable fragments

Output: teacher-docs/content/20-building-activities/07-fragments.md · order 7

Job: A teacher who keeps rewriting the same prompt wording (a teaching style, a
safety policy, a language rule) across activities. After this chapter they can write
a fragment library of their own and reuse it in tutors, quizzes, writing, and coding
activities.

Cover:
- Fragments are not a tutor-only feature: one library serves all four activity
  kinds. Where the block goes in each file kind (inside `prompt:` for a tutor, at
  the top level for a quiz, writing, or coding activity), and that fragments always
  come before the activity's own instructions.
- What a library file looks like: the file's `id` plus a list of fragments, each
  with an `id`, a `version`, a `priority`, optional declared inputs, and the
  `content` text.
- Writing the content as a template: insert a value, loop over a list, switch text
  on a true/false flag. Text is inserted verbatim; using a variable the fragment
  never declares fails validation.
- Declaring inputs: the three value types (text, true/false, list of text),
  which inputs are required, and optional inputs with a `default`.
- How the final prompt is ordered: `priority`, ascending, activity instructions
  last; the listing order in the activity file does not matter.
- Validating a library on its own (app selector and CLI `--kind fragment`), and
  that validating or sharing an activity checks every fragment in every library it
  references.
- Hosting: a public web address or a file hosted in the app; relative references
  resolve next to the activity file.

Get right:
- The quiz case is special: fragments apply to BOTH the grading of answers and the
  follow-up discussion chat.
- Two fragments used by one activity must not share a `priority`, even when they
  come from different libraries; validation rejects the activity.
- A `default` is used only when the activity omits the value; a supplied value
  always wins; a `default` on a required input can never apply and draws a warning.
- `version` is a number the library author raises on meaningful change; it does not
  change behaviour today. Same for the optional classification label: say so
  briefly rather than implying semantics that don't exist.
- If a library cannot be loaded or a fragment fails when a student opens the
  activity, the activity refuses to start; missing rules are never silently
  dropped.
- Reuse real YAML: the shared example library and the minimal library from the
  tutor authoring guide (its `greeting` default). Do not invent fragment ids that
  don't exist in the quoted library.
- Keep this the one deep fragment chapter: the tutors chapter covers using
  fragments from the consumer side and should stay lighter.

Look: activities/tutors/README.md (fragment library reference, inputs, assembly,
hosting), activities/fragments/README.md, the fragment sections of the quiz /
writing / coding activities' README.md, activities/examples/shared/.
