# Building a tutor

Output: teacher-docs/content/20-building-activities/03-tutors.md · order 3

Job: A teacher ready to write a tutor file. After this chapter they know the fields
that make a tutor and how to shape it with their instructions and, optionally, reusable
fragments, working from a real example.

Cover:
- The core: an id, a model, and your instructions (the free-text guidance that makes
  the tutor behave the way you want).
- Common options students notice: a name, a greeting, a short description, and clickable
  starter questions on the empty chat.
- Fragments: declaring a library under `fragment_files:` and placing a reusable, named
  piece of prompt with an inline `{{fragment "alias.id" …}}` marker in `tutor_instructions`,
  supplying its values as marker arguments, and when that is worth it versus just writing
  instructions directly. Stay on the consumer side: writing a library of your own is the
  reusable-fragments chapter's job.
- Built-in tools: a tutor can opt in to server-side tools the AI may call during
  the chat, via a top-level `tools:` list. What a tool is (the model decides to call
  it, the server runs it, the model uses the result in its answer), the EXHAUSTIVE
  list of available tools — currently exactly one, `random_number` (a uniformly
  random whole number between `min` and `max`, both inclusive, with true server-side
  randomness) — and why it exists: AI models repeat the same "random" numbers, so
  practice problems come out alike; the tool gives real variety. Two rules teachers
  must know: an unknown tool name fails validation, and the app never tells the
  model about its tools — the teacher's `tutor_instructions` must say when to use
  each tool (show the one-line phrasing, e.g. "use the random_number tool to pick
  the practice values").
- Walk a real example (the sorting-algorithms sample tutor) rather than inventing YAML.

Get right:
- The instructions field is where your own guidance goes; fragments are optional.
- A fragment library is hosted like the tutor itself: a public URL or a file hosted in
  the app. Validating a tutor checks every fragment in a library it references, even
  unused ones.
- Fragments are not tutor-only: the same libraries work in quizzes, writing, and coding
  activities (one sentence; the reusable-fragments chapter has the detail).
- A fragment lands where its marker sits in `tutor_instructions`; there is no priority
  and no separate `fragments:` list. If an older tutor still has them, it is the old
  format; do not describe priority ordering.
- An optional fragment input can carry a default the library author set; supplying a
  value as a marker argument overrides it.
- Provider and model can be overridden per code; link to "Available AI models" instead
  of repeating it.
- Reuse real YAML from activities/examples/**.

Look: activities/tutors/README.md (incl. the `tools` section with the tool table),
activities/examples/** (sorting-tutor and the shared fragment library), docs/tutor-tools.md.
