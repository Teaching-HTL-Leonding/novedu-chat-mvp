# Available AI models

Output: teacher-docs/content/20-building-activities/02-available-llms.md · order 2

Job: A teacher configuring an activity who needs to choose which AI model runs it, and
where. After this chapter they know what the activity's `llm:` block sets (a required
model, an optional provider), what the two providers mean to them, that the default is
the school's own server, and that a code can override model + provider per share
without editing the YAML.

Cover:
- The `llm:` block: required `model`, optional `provider`.
- The two providers in teacher terms: SCCH (the school's self-hosted AI server, the
  default) and Azure Foundry (runs the activity on an Azure deployment, where `model`
  names the deployment). Azure Foundry is optional; without it, activities run on SCCH.
- Overriding provider + model per code, always both together, without editing the YAML.
- Show a real `llm:` block from an example activity.

Get right:
- Omitting `provider` means SCCH. With Azure Foundry, `model` names the deployment.
- The per-code override is both-or-nothing (provider and model together).
- Do not print a fixed list of model names; they are school-set and change. Point
  teachers at their sample activities and the create-code presets instead.
- Do not make cost or pricing claims (for example "SCCH is free"); the sources do not
  state pricing. Describe SCCH as the default, the school's own server, no more.

This chapter sits closest to internals: describe the teacher's choice and its effect,
never how a provider connects or authenticates. Expand "SCCH" once as "the school's
self-hosted AI server."

Look: activities/README.md (the llm: block + per-code override), docs/ai-models.md
(teacher-visible parts only), a real llm: block under activities/examples/**.
