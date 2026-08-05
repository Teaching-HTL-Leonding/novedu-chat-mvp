# Reusable fragments

Output: teacher-docs/content/20-building-activities/07-fragments.md · order 7

Job: A teacher who keeps rewriting the same prompt wording (a teaching style, a
safety policy, a language rule) across activities, or who wants existing course
material inside a prompt without copy-pasting it. After this chapter they can write
a fragment library of their own and place its fragments in tutors, quizzes, writing,
and coding activities, and they can embed a plain-text file (course notes, a sample
solution) with a text-file marker.

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
  writing or coding activity's `instructions`, and a quiz's two optional fields, the
  top-level `instructions` and `discussion.instructions` (introduce them here as
  where a quiz's markers live).
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
- Embedding plain-text files: alongside `fragment_files:` an activity may declare
  `text_files:` (same shape: an id alias plus a web address, declared in the same
  place per kind) and splice a file into its instructions with an inline
  `{{file "alias"}}` marker. The file is inserted exactly as fetched — it is ordinary
  text, not a template, so `{{ }}` inside the material stays literal and needs no
  escaping. Optional `from=` / `to=` line numbers (1-based, both ends included,
  either alone works) embed just an excerpt; the same file can be placed several
  times with different ranges. Typical uses: markdown course material for a tutor,
  a sample-solution source file for a coding activity (the linked-lists example).

Get right (text files):
- The marker uses a bare quoted alias with no dot — there is nothing to select
  inside a plain file — and takes no other values than `from=` / `to=`.
- One shared alias namespace: a `text_files` id must not collide with a
  `fragment_files` id.
- Declaring either list turns the instructions into a template, so the `\{{`
  escaping rule then applies to the teacher's own prose (not to fetched content).
- Validation fetches every declared text file and checks every placed line range
  against the real file; a range past the end of the file fails validation. A file
  bigger than 200 KB is rejected.
- Text files are fetched fresh when a student opens the activity, like fragment
  libraries: editing the hosted file changes the prompt without touching the
  activity. If the file cannot be fetched, the activity refuses to start.

Get right:
- The quiz case is special: a quiz's markers may live in two fields. The top-level
  `instructions` applies to BOTH the grading of answers and the follow-up discussion
  chat; `discussion.instructions` steers only the discussion chat and takes the same
  markers. Per-question `evaluation` stays plain text.
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
