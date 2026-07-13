# Glossary (teacher-word → app-word)

The single source of truth for recurring terms. In a chapter, mark a term with
`[[term]]` on first use (see the style rules); this file supplies the definition a
renderer shows. The docs site (`teacher-docs-site/`) renders it as the guide's
glossary page, one anchor per term, and links every `[[term]]` marker to it. Seed
entries below; grow it as chapters are written.

- **Activity**: one thing you build for students: a tutor, a quiz, a writing task,
  or a coding endpoint. Defined by a YAML file.
- **Code**: the short shareable link you hand to a class to open an activity.
- **Module / kind**: which sort of activity a code runs (tutor, quiz, writing,
  coding). Frozen when the code is created.
- **YAML**: the plain-text format you write an activity in. No programming needed;
  you fill in fields by example.
- **Fragment**: a reusable, named piece of prompt (a persona, a rule, a safety
  policy) you write once and pull into activities.
- **Prompt** (LLM sense): the instructions that tell the AI how to behave. In
  Novedu you configure activities by *writing prompts*, not by training a model.
- **Provider**: where an activity's AI runs: the school's own server (SCCH) or
  Azure. A teacher choice, set per code.
- **Anonymous vs. per-user**: whether an activity records who did what. Default
  differs by module.
