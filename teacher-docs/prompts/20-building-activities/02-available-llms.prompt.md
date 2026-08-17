# Available AI models

Output: teacher-docs/content/20-building-activities/02-available-llms.md · order 2

Job: A teacher configuring an activity who needs to choose which AI model runs it,
where, and how hard it thinks. After this chapter they know what the activity's `llm:`
block sets (a required model, an optional provider, an optional reasoning level), what
the two providers mean to them, that the default is the school's own server, and that a
code can override the whole block per share without editing the YAML.

Cover:
- The `llm:` block: required `model`, optional `provider`, optional `reasoning`.
- The two providers in teacher terms: SCCH (the school's self-hosted AI server, the
  default) and Azure Foundry (runs the activity on an Azure deployment, where `model`
  names the deployment). Azure Foundry is optional; without it, activities run on SCCH.
- The reasoning level: `minimal`, `low`, `medium` or `high`, how much thinking effort
  the model spends before answering. Left out, the model decides for itself. Only
  reasoning-capable models act on it.
- Overriding per code without editing the YAML: provider + model always together, the
  reasoning level optional on top of them.
- Show a real `llm:` block from an example activity.

Get right:
- Omitting `provider` means SCCH. With Azure Foundry, `model` names the deployment.
- Omitting `reasoning` means the model's own default, not a fixed level of ours.
- The per-code override's provider and model are both-or-nothing, and a reasoning level
  only works alongside them. The override replaces the WHOLE `llm:` block, so an
  override that names no reasoning level also drops the one in the YAML.
- Do not print a fixed list of model names; they are school-set and change. Point
  teachers at their sample activities and the create-code presets instead.
- Do not make cost or pricing claims (for example "SCCH is free"); the sources do not
  state pricing. Describe SCCH as the default, the school's own server, no more.

This chapter sits closest to internals: describe the teacher's choice and its effect,
never how a provider connects or authenticates. Expand "SCCH" once as "the school's
self-hosted AI server."

Look: activities/README.md (the llm: block + per-code override), docs/ai-models.md
(teacher-visible parts only), a real llm: block under activities/examples/**.
