# Chapter: What is Novedu

## Output
- File: teacher-docs/content/00-introduction/01-what-is-novedu.md
- Sidebar order: 1

## Audience & job to be done
A teacher opening the docs for the first time, deciding whether and how Novedu fits
their teaching. After this chapter they can explain what Novedu is, name the four
activity kinds and what each is *for*, and grasp the core idea: **you shape the AI
by writing instructions (prompts), not by training or programming a model.** This is
the conceptual on-ramp, no configuration detail.

## Scope
- In: what Novedu is; the four activity kinds (tutor, quiz, writing, coding) and
  their purpose; "configure by prompting, not fine-tuning" and why it helps teaching
  (fast to try and adjust, transparent, fully teacher-controlled, no data science);
  the author-an-activity → share-a-code shape; that no programming is required.
- Out: how to write YAML, field-level configuration, code mechanics, statistics,
  models, each has its own chapter; link forward. **No internals of any kind** (see
  references/scope.md): describe what a teacher gets, never how it is
  built or secured.

## Where to look (hints, not an allowlist)
- The product overview and the activities authoring overview.
- The tutor authoring guide's "the idea in one minute" for the
  prompting-not-fine-tuning framing, keep it conceptual; don't pull tutor config in.

## Facts that are easy to get wrong
- There are exactly **four** activity kinds: tutor, quiz, writing, coding.
- Behavior comes from a **prompt the teacher writes/assembles**: not from
  fine-tuning or training a model. (This is the load-bearing idea; get the framing
  right.)

## Notes & gotchas
- Most-read chapter; set the tone, warm, plain, confidence-building. Mirror the
  tutor guide's "You do not need to be a programmer."
- Define *activity* and *code* on first use and link the glossary; don't deep-dive.
- Resist listing YAML fields or any concrete configuration, that's the failure mode
  for this chapter. Stay at the level of ideas and purpose.
- Make prompting-not-fine-tuning intuitive (like giving very clear written
  instructions to a capable assistant), not an ML explanation.

## Frontmatter hints
- title: What is Novedu
- description: Novedu lets teachers give students AI activities they fully control by writing instructions, not training models.
- keywords: [Novedu, overview, AI, tutor, quiz, writing, coding, prompting, getting started]
