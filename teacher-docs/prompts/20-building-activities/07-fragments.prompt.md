# Reusable fragments

Output: teacher-docs/content/20-building-activities/07-fragments.md · order 7

Job: A teacher who keeps rewriting the same prompt wording (a teaching style, a
safety policy, a language rule) across activities. After this chapter they can write
a fragment library of their own and place its fragments in tutors, quizzes, writing,
and coding activities.

Cover:
- Fragments are not a tutor-only feature: one library serves all four activity
  kinds. Where the `fragment_files:` declaration goes in each file kind (inside
  `prompt:` for a tutor, at the top level for a quiz, writing, or coding activity).
- The model in one line: you list the libraries an activity may draw from under
  `fragment_files:`, then place each fragment exactly where you want it by writing a
  marker directly in the activity's own instructions text. There is no separate list
  of fragments and no ordering number; a fragment appears where its marker sits.
- The marker: `{{fragment "alias.id" name="value" flag=true items=(array "a" "b")}}`.
  The alias is the library's `fragment_files` id, the id is the fragment's id, split
  at the first dot. Passing values through the marker (text, true/false, a list). The
  same fragment can be placed more than once with different values.
- Which text is the "instructions" for each kind: a tutor's `tutor_instructions`, a
  writing or coding activity's `instructions`, and a quiz's own top-level
  `instructions` (a new optional field; introduce it here as where a quiz's markers
  live).
- What a library file looks like: the file's `id` plus a list of fragments, each with
  an `id`, an optional `version`, optional declared inputs, and the `content` text.
- Writing the content as a template: insert a value, loop over a list, switch text on
  a true/false flag. Text is inserted verbatim; using a variable the fragment never
  declares fails validation.
- Declaring inputs: the three value types (text, true/false, list of text), which
  inputs are required, and optional inputs with a `default`.
- The opt-in and literal braces: an activity that declares no `fragment_files:` is
  left exactly as written, so plain activities and examples that contain `{{ }}` as
  ordinary text are safe. In an activity that does use fragments, a literal `{{` in
  your own prose must be written `\{{` so it isn't read as a marker.
- Validating a library on its own (app selector and CLI `--kind fragment`), and that
  validating or sharing an activity checks every fragment in every library it
  references.
- Hosting: a public web address or a file hosted in the app; relative references
  resolve next to the activity file.

Get right:
- The quiz case is special: a quiz's markers live in a top-level `instructions` field,
  and that text applies to BOTH the grading of answers and the follow-up discussion
  chat. It is separate from `discussion.instructions`.
- There is no `priority` and no separate `fragments:` list any more; order is simply
  where you place the marker in the text. If an older activity still has them, it is
  the old format. Do not describe priority ordering.
- A value passed in a marker may be text (`name="value"`), true/false (`flag=true`),
  or a list written with the `array` helper (`items=(array "a" "b")`); those are the
  only shapes. The reference must be in quotes.
- A `default` is used only when the marker omits the value; a supplied value always
  wins; a `default` on a required input can never apply and draws a warning.
- `version` is optional now; it is a number the library author raises on meaningful
  change and does not change behaviour today. Same for the optional classification
  label: say so briefly rather than implying semantics that don't exist.
- If a library cannot be loaded or a fragment fails when a student opens the activity,
  the activity refuses to start; missing rules are never silently dropped. A marker in
  an activity that forgot to declare its `fragment_files:` is shipped as literal text,
  so encourage declaring the library.
- Reuse real YAML: the shared example library and the minimal library from the tutor
  authoring guide (its `greeting` default). Do not invent fragment ids that don't
  exist in the quoted library. Prefer showing a marker exactly as the sample
  activities write it.
- Keep this the one deep fragment chapter: the tutors chapter covers placing fragments
  from the consumer side and should stay lighter.

Look: activities/tutors/README.md (fragment library reference, inputs, marker syntax,
hosting), activities/fragments/README.md, the fragment sections of the quiz / writing
/ coding activities' README.md, activities/examples/shared/ and the example activities
that place markers.
