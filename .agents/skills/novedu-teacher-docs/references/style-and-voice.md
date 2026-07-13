# Style & voice

The project-specific voice lives in `teacher-docs/style.md` (human-owned, may
override this). This file is the reusable rulebook behind it.

## Writing constraints (hard rules)

Not optional. They govern how the docs read and how they behave when a future search
or RAG layer splits them into chunks.

- **No em-dashes.** Use a comma, a colon, parentheses, or a full stop instead. An
  em-dash is a common machine-writing tell and cheap to avoid.
- **No AI slang.** Skip words like *delve*, *leverage*, *seamless*, *robust*,
  *unlock*, *empower*, *streamline*, *elevate*, and filler like *it's worth noting*
  or *in the realm of*. Say the plain thing a teacher would say.
- **Write self-contained sections; no anaphora across headings.** Any section may
  later be pulled out on its own and shown without the rest of the page, so it has to
  stand alone. Name the subject in each section instead of pointing back at an
  earlier one. Write "Photo answers are off by default", not "This is off by
  default". Avoid "as mentioned above", "the former"/"the latter", and a "this",
  "that", or "it" whose referent sits under another heading. A normal pronoun inside
  the same paragraph is fine; the rule is about references that break when a chunk is
  read alone.

## Voice and tone

Warm, clear, and ready to help. Sound like a knowledgeable colleague sitting next to
the teacher, not a manual.

- **Talk like a person.** Write the way you would explain it out loud; read a
  sentence aloud and if it sounds stiff, rewrite it. Use contractions ("you'll",
  "it's", "don't").
- **Get to the point.** Lead with what matters to the teacher, then the detail.
  Bigger ideas, fewer words. Cut any sentence that doesn't help them act.
- **Be positive and direct.** Tell the teacher what to do, not only what to avoid.
  "Set a time window to open the code only during the lesson" beats "Don't forget the
  code is open until you close it."
- **Second person, active voice, present tense.** "You share the link and students
  open the activity." Not "The link is shared and the activity is opened."
- **Encouraging.** Many readers are trying something new. "You don't need to be a
  programmer" is the tone.

## Words

- **Simple, common words.** "Use", not "utilize". "Enough", not "sufficient". "Help",
  not "facilitate".
- **No idioms or cultural metaphors.** Readers are Austrian teachers reading English
  as a second language, so skip sports metaphors, wordplay, and humour that could
  miss. Plain and literal reads clearly for everyone.
- **Spell out Latin abbreviations.** "For example", not "e.g."; "that is", not "i.e.";
  "and so on", not "etc." where you can.
- **British English, consistently.** The audience is Austrian schools, which teach
  British English, so use British spelling ("behaviour", "colour", "organise",
  "practise" the verb) and never mix in American forms ("behavior", "practicing")
  within or across chapters. Keep proper nouns and code (model ids, field names, CLI
  flags) exactly as written in the source.
- **Introduce a term clearly the first time it matters**, so a section still makes
  sense on its own (for example, "a code, the short link you hand to a class").
  Expand an acronym the first time it appears.
- **Mark glossary terms with `[[term]]`** on their first use in a chapter, using a
  term from `teacher-docs/glossary.md` (for example `[[activity]]`). This is the only
  glossary mechanism: do not write a normal markdown link or an anchor. A build step
  (for example an Astro remark plugin) turns `[[term]]` into a glossary link or
  tooltip; left untouched it still reads as the plain word. Mark the first
  occurrence, not every one. For a plural or inflection use `[[term|shown]]`, for
  example `[[activity|activities]]`.
- **Never an internal name** (a file, function, route, or table). See
  `references/scope.md`.

## Mechanics

- **Sentence-style capitalization** for headings and titles: capitalize the first
  word and proper nouns only. "Time-limiting a code", not "Time-Limiting a Code".
- **Serial (Oxford) comma:** "tutors, quizzes, and writing tasks".
- **Numbers:** spell out zero to nine in ordinary prose; use numerals for 10 and up,
  and always for versions, counts shown on screen, and anything technical (`llm`
  fields, CLI flags).
- **Descriptive link text**, never "click here" or a bare URL. The link text should
  make sense on its own, which also helps a reader skimming or a standalone chunk.
- **Procedures:** one action per numbered step; put the on-screen label the teacher
  selects in bold ("Select **Create code**"). Short intro line, then the steps.
- **Short blocks.** Short sentences, short paragraphs, generous headings and lists. A
  teacher skims between lessons.
- **Relationships go in frontmatter, not the body.** Do not write a "Where to go
  next" or "Related" section with inline links. Put related chapter slugs in the
  `related` frontmatter field and let the renderer build the navigation. This keeps
  each section self-contained and the corpus renderer-agnostic.

## Audience

Teachers at Austrian schools with a **mixed** technical background, from CS teachers
who are comfortable with YAML and a CLI to language or arts teachers who are not. The
current **reviewer** is the app author (an engineer), so accuracy review is strong,
but the *audience* is the teacher, so write for them, not the reviewer.

## Diátaxis lean

The corpus is **module-spine reference + explanation**, with how-to woven in.
Weight the four types for this audience:

- **Explanation** (why / what it is): heavy in the Introduction chapters. Give
  teachers the mental model (prompting instead of fine-tuning; teacher-configurable
  agents) before mechanics.
- **Reference** (what each field does): the backbone of the "Building activities"
  chapters. Predictable structure here also helps any later search/retrieval layer.
- **How-to** (do this task): woven into building/sharing chapters; a future
  `recipes/` track (jobs-to-be-done) can grow from real teacher questions.
- **Tutorial** (learn by doing): deferred; not in the first corpus.

## Examples

Reuse the real sample activities under `activities/examples/` rather than inventing
YAML. They are validated and canonical, so quoting them keeps the docs correct and
gives teachers something they can actually copy.

## Screenshots

Placeholders + descriptive alt text for now (see the skill's screenshots note).
Write the alt text as if it were the final caption, so a later curated image drops
in cleanly.
