# Available AI models

Output: teacher-docs/content/20-building-activities/02-available-llms.md · order 2

Job: A teacher configuring an activity who needs to choose which AI model runs it,
where, and how hard it thinks. After this chapter they know what the activity's `llm:`
block sets (a required model, an optional provider, an optional reasoning level), what
the two providers mean to them, that the default is the school's hosting partner, and
that a code can override the whole block per share without editing the YAML.

Cover:
- The `llm:` block: required `model`, optional `provider`, optional `reasoning`.
- The two providers in teacher terms: SCCH (the school's Austrian LLM hosting partner,
  the default) and Azure Foundry (runs the activity on an Azure deployment, where `model`
  names the deployment). Azure Foundry is optional; without it, activities run on SCCH.
- The reasoning level: `none`, `minimal`, `low`, `medium`, `high` or `xhigh`, how much
  thinking effort the model spends before answering. Left out, the model decides for
  itself. `none` turns a thinking model off, which is NOT the same as leaving the field
  out (then the model keeps its own default).
- What the level actually does varies per model, and there are three behaviours a
  teacher meets. Measured at the school's hosting partner and on Azure:
  - A real ladder: Qwen 3.8 spends steadily more thinking from `low` to `medium` to
    `xhigh` (its default, and roughly two and a half times the thinking of `low`), and
    the Azure gpt-5.x deployments behave the same way.
    Both refuse some level names outright: Qwen 3.8 accepts only `none`, `low`,
    `medium` and `xhigh`, and one of the gpt deployments refuses `minimal` while
    another accepts it.
  - An on/off switch: Gemma 4 accepts every level but acts on `none` alone. Asking it
    for `high` instead of `low` gives literally the same answer, so the only useful
    choice there is thinking on or thinking off.
  - A refusal: a level the model does not know fails when a student uses the activity,
    the same way a wrong model name does, so always test an activity once after
    setting the level.
  Say plainly that a teacher cannot tell from the app which group a model is in, so the
  way to find out is to try it, and that a shorter level is the safer classroom default
  because thinking costs waiting time and counts towards the activity's usage.
- Cost: activities at the school's hosting partner do not bill per use, the school's
  contract with the partner covers them. Azure models (the gpt ones) are paid per use,
  so every message, and every extra bit of thinking, costs real money on someone's
  Azure bill. Tell the teacher to prefer the hosting partner for everyday classroom
  work and to keep Azure for the cases that need it, and to watch the reasoning level
  there in particular.
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
  teachers at their sample activities and the create-code presets instead. Naming a
  model when describing how it handles reasoning levels is fine, that is a measured
  observation, but frame it as an example of the three behaviours rather than a
  catalogue.
- Cost is a real difference and belongs in the chapter: the school's hosting partner
  carries no usage-based cost under the school's contract, while Azure Foundry bills
  per use. Do not invent prices, rates, or budgets; there are none in the sources. Say
  which side costs money per use and let the teacher act on it.

This chapter sits closest to internals: describe the teacher's choice and its effect,
never how a provider connects or authenticates. Expand "SCCH" once as "the school's
Austrian LLM hosting partner". SCCH is a PARTNER the school buys hosting from, not
hardware the school owns, so never call it the school's own server, self-hosted, or
in-house anywhere in the corpus; short later mentions are "SCCH" or "the school's
hosting partner".

Look: activities/README.md (the llm: block + per-code override), docs/ai-models.md
(teacher-visible parts only), a real llm: block under activities/examples/**.
