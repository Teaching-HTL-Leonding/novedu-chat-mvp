---
title: Choosing an AI model for your activity
description: Set the AI model and provider in an activity's llm block, and override both per code without editing the YAML.
sidebar:
  order: 2
audience: teacher
keywords: [AI model, LLM, provider, SCCH, Azure Foundry, llm block, model override]
related:
  - 30-sharing-activities/01-creating-codes
  - 10-yaml-for-teachers/04-cli-validation
generated: true
---

<!--
  GENERATED FILE, do not edit by hand.
  Edit the chapter prompt in teacher-docs/prompts/20-building-activities/02-available-llms.prompt.md and regenerate.
-->

Every [[activity]] tells Novedu which AI model should run it. You set that in the `llm:` block of the activity's [[YAML]] file. The block is small: a required `model` and an optional `provider`.

```yaml
llm:
  model: RedHatAI/gemma-4-31B-it-FP8-Dynamic
```

That's the whole block in most activities, taken from the sorting-algorithms sample tutor. The same block works in tutors, quizzes, writing activities, and coding activities.

## The two providers

The [[provider]] decides where the AI runs. There are two choices:

- **SCCH** (the school's self-hosted AI server): the default. If you leave out `provider`, your activity runs here. Here `model` is a raw model id, like the one in the sample above.
- **Azure Foundry**: runs the activity on an Azure deployment your school has set up. With this provider, `model` names the Azure deployment, not a raw model id.

An activity that runs on Azure looks like this:

```yaml
llm:
  model: gpt-5.4-mini
  provider: Azure Foundry
```

Azure Foundry is optional. Not every school connects one; if yours hasn't, all activities simply run on the school's self-hosted server, and Novedu shows a readable error if you try to save an activity or a code that asks for Azure Foundry.

## Which model names can I use?

There is no fixed list to print here: the available models are set up by your school and change over time. Two reliable places to look:

- **The sample activities** your school shares (for example the ones under `activities/examples/` in the Novedu repository). They always name a model that works.
- **The preset buttons on the create-code form.** When you create a code, the form offers one-click presets that fill in a known-good provider and model pair.

The `model` field is free text, so a typo isn't caught when you save the file. A wrong name only fails when a student starts chatting, so copy a model name from a working sample rather than typing it from memory.

If you validate your YAML with the Novedu CLI, use version 0.6.0 or newer when the file sets `llm.provider`; older versions reject the field.

## Override the model per code, without editing the YAML

The `llm:` block is only the activity's default. When you create or edit a [[code]] (the short link you hand to a class), the form lets you override the provider and the model for that one code. The YAML file stays untouched, so the same activity can run once on the school's server and once on Azure, just by creating two codes.

A few things to know about the override:

- **It's both or nothing.** You set the provider and the model together, or neither. A half-filled pair is rejected when you save.
- **Presets fill it in one click.** The form offers buttons for common provider and model pairs, plus a **Clear** button that returns the code to the activity's own `llm:` settings.
- **You can change it later.** Unlike the activity file, the override isn't frozen; edit the code any time to switch models.
- **Only the model changes.** Everything else, such as the instructions and the anonymity setting, still comes from the YAML file. If your tutor lets students upload images, pick an override model that can read them.
