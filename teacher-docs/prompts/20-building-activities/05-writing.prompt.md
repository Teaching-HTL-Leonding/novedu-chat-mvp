# Building a writing activity

Output: teacher-docs/content/20-building-activities/05-writing.md · order 5

Job: A teacher writing a writing-activity file. After this chapter they know the fields
(the task, the coach's instructions, an optional scaffold) and how to shape a coach
that advises without rewriting, working from a real example.

Cover:
- The core: an id, a model, and the coach's instructions.
- The task students see: a title and description, plus an optional starter scaffold
  prefilled into the editor.
- Shaping the coach: tell it to read the draft and give advice and guiding questions,
  not finished sentences. The coach cannot edit the text, so write instructions that
  fit a read-only helper.
- Walk a real example (the restaurant-review letter).
- Reusing fragments: a writing activity declares libraries under a top-level
  `fragment_files:` and places fragments with inline `{{fragment "alias.id" …}}` markers
  directly in its `instructions`. Short section; the reusable-fragments chapter has the
  detail.

Get right:
- The coach reads the draft with a read-only tool and cannot change it; write the
  instructions accordingly.
- Writing records the author by default; if you make it anonymous, saving is turned off
  (there is nothing to keep). Link to "Anonymous vs. per-user".
- Reuse real YAML from activities/examples/**.

Look: activities/writings/README.md, activities/examples/** (restaurant-review-letter).
