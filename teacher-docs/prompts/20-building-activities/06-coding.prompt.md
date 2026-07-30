# Building a coding activity

Output: teacher-docs/content/20-building-activities/06-coding.md · order 6

Job: A teacher writing a coding-activity file. After this chapter they know the small
set of fields (an id, a model, and instructions), how to constrain the assistant, and
which fields coding does not allow, working from a real example.

Cover:
- The core: an id, a pinned model, and instructions, which are the assistant's rules.
- Shaping the assistant: describe what the class may use (language, the subset of
  features, teaching style) so its help stays within what students have learned.
- What coding leaves out: it has no anonymous, placeholder, or description fields, and
  it is always anonymous.
- Note that students connect their own tool separately; link to the coding sharing
  chapter for that side.
- Walk a real example (the sorting-visualizer).
- Reusing fragments: a coding activity declares libraries under a top-level
  `fragment_files:` and places fragments with inline `{{fragment "alias.id" …}}` markers
  directly in its `instructions`. Short section; the reusable-fragments chapter has the
  detail.

Get right:
- The model is pinned by the teacher; a student's tool cannot change it.
- The instructions apply on the server and students do not see them; describe the
  effect, not the mechanism.
- Do not add anonymous, placeholder, or description fields; the validator rejects them.
- Reuse real YAML from activities/examples/**.

Look: activities/coding/README.md, activities/examples/** (sorting-visualizer).
