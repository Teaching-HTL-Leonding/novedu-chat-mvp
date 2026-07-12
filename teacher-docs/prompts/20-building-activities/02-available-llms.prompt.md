# Chapter: Available AI models

## Output
- File: teacher-docs/content/20-building-activities/02-available-llms.md
- Sidebar order: 2

## Audience & job to be done
A teacher configuring an activity who needs to choose which AI model runs it, and
where. After this chapter they know the two things an activity's `llm:` block sets
(a required model, an optional provider), what the two providers mean *to them*, that
the default is the school's own server, and that a code can override model + provider
per share without duplicating the YAML.

## Scope
- In: the `llm:` block as the activity's default; the two provider choices in
  teacher terms, **SCCH** (the school's self-hosted AI server; the default) and
  **Azure Foundry** (runs the activity on an Azure deployment); overriding provider +
  model **per code**; that Azure Foundry is optional.
- Out: **how any of it connects**: endpoints, keys, tokens, sign-in, availability
  checks, any file/function names. All internal, must never appear (see
  references/scope.md). Also out: a hard-coded list of which model names
  exist, those change and are set by the school; point teachers at their sample
  activities and the create-code presets instead.

## Where to look (hints, not an allowlist)
- The activities authoring overview's description of the `llm:` block and the
  per-code override.
- The AI-models engineer doc, **teacher-visible parts only** (provider names,
  defaults, that Foundry is optional, the per-code override). Everything about how a
  provider connects or authenticates is internal and out of scope.
- A real activity's `llm:` block from the examples, to show the exact shape.

## Facts that are easy to get wrong
- Omitting `provider` uses **SCCH** (the school's self-hosted server); with **Azure
  Foundry**, `model` names the *deployment*.
- The `llm:` block is the **default**; a code can override provider + model per
  share, **always both together** (both-or-nothing), with one-click presets.
- Azure Foundry is **optional**: without it, activities run on SCCH only.
- Do **not** enumerate concrete model names as fixed; they change / are school-set.

## Notes & gotchas
- This chapter sits closest to internals, treat scope.md as a hard gate.
  If a sentence explains *how* a provider connects or authenticates, it's wrong for
  this doc. Describe only the teacher's choice and its effect.
- "SCCH" is an acronym teachers will see but may not know, expand it once as "the
  school's self-hosted AI server" and move on; don't speculate about the letters
  beyond what the source says.
- Quote a real `llm:` block from an example activity so the teacher sees the shape.

## Frontmatter hints
- title: Available AI models
- description: Choose which AI model runs an activity and whether it uses the school's server or Azure, set a default, override per code.
- keywords: [model, provider, SCCH, Azure Foundry, llm, AI model, per-code override]
