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
- Fragments: pulling in reusable, named pieces of prompt and supplying their values, and
  when that is worth it versus just writing instructions directly. Stay on the consumer
  side: writing a library of your own is the reusable-fragments chapter's job.
- Walk a real example (the sorting-algorithms sample tutor) rather than inventing YAML.

Get right:
- The instructions field is where your own guidance goes; fragments are optional.
- A fragment library is hosted like the tutor itself: a public URL or a file hosted in
  the app. Validating a tutor checks every fragment in a library it references, even
  unused ones.
- Fragments are not tutor-only: the same libraries work in quizzes, writing, and coding
  activities (one sentence; the reusable-fragments chapter has the detail).
- Two fragments a tutor uses must not share a priority, even across different
  libraries; validation rejects the file.
- An optional fragment input can carry a default the library author set; supplying a
  value overrides it.
- Provider and model can be overridden per code; link to "Available AI models" instead
  of repeating it.
- Reuse real YAML from activities/examples/**.

Look: activities/tutors/README.md, activities/examples/** (sorting-tutor and the shared
fragment library).
