---
title: Building a tutor
description: The fields that make a tutor YAML file, what students see on the empty chat, and when reusable fragments are worth the effort.
sidebar:
  order: 3
audience: teacher
keywords: [tutor, tutor_instructions, instructions, fragments, fragment library, starter questions, exampleQuestions, greeting, YAML]
related:
  - 00-introduction/03-tutors-overview
  - 20-building-activities/02-available-llms
  - 20-building-activities/01-handling-yaml
  - 10-yaml-for-teachers/04-cli-validation
generated: true
---

<!--
  GENERATED FILE, do not edit by hand.
  Edit the chapter prompt in teacher-docs/prompts/20-building-activities/03-tutors.prompt.md and regenerate.
-->

# Building a tutor

A tutor is one [[YAML]] file. At its core it needs three things: an id, an AI model, and your instructions, the free-text guidance that makes the tutor behave the way you want. Everything else is optional polish. This chapter walks through the fields using the sorting-algorithms sample tutor, a real, validated file you can copy from.

## The required fields

Five fields are required: `id`, `name`, `description`, an `llm` block with a `model`, and `prompt.tutor_instructions`. Here they are with the values from the sample tutor:

```yaml
id: ts-sorting-algorithms
name: "Tutor für Sortieralgorithmen (Bubble & Selection Sort)"
description: |
  Ich helfe dir, Bubble Sort und Selection Sort in TypeScript zu verstehen ...

llm:
  model: RedHatAI/gemma-4-31B-it-FP8-Dynamic

prompt:
  tutor_instructions: |
    You are a tutor for 16-year-old students at a vocational college. ...
```

- **`id`** is a short machine name, such as `fractions-de`. Students never see it.
- **`name`** is the human-readable title of the tutor.
- **`description`** appears to students on the empty chat, below the greeting. Write it for them: say what the tutor helps with, in the language your class speaks.
- **`llm.model`** names the AI model. An optional `provider` chooses where it runs, and when you create a [[code]] for the tutor you can override both without touching the file. The chapter on choosing an AI model covers the details.
- **`tutor_instructions`** is where your own guidance goes: free text that tells the tutor how to behave.

## Your instructions

The `tutor_instructions` field is free text in your own words: who the tutor is, what it teaches, how it should respond, and what it must not do. It always comes last in the assembled [[prompt]], after any fragments, so it carries the concrete, tutor-specific framing.

For a one-off tutor, it's fine to put the whole prompt here and skip fragments entirely. The sample tutor uses its instructions for the class-specific parts: what the students already know (basic TypeScript, no classes or arrow functions yet), the learning goals of the unit, and didactic hints such as preferring tiny concrete arrays over abstract talk.

## What students notice on the empty chat

Two optional fields shape the screen students see before their first message:

- **`title`** replaces the default "How can I help you today?" greeting. Leave it out to keep the default.
- **`exampleQuestions`** adds clickable starter questions below the description. Each entry has a short `title` (the clickable label) and the full `question` text. Clicking a label puts the question into the chat input, and students can still edit it before sending.

```yaml
exampleQuestions:
  - title: "Wie funktioniert Bubble Sort?"
    question: "Kannst du mir Schritt für Schritt erklären, wie Bubble Sort ein Array sortiert?"
  - title: "Bubble vs. Selection Sort"
    question: "Was ist der Unterschied zwischen Bubble Sort und Selection Sort? Wann ist welcher besser?"
```

You can define any number of starter questions, but students see at most five. With more than five, a random selection of five appears on each page load, kept in the order you wrote them, so order them deliberately, for example from easy to hard.

## Fragments: reusable pieces of prompt

A [[fragment]] is a named piece of prompt (a teaching style, a topic list, a safety policy) that lives in a separate fragment library file and can be pulled into many tutors. Write a rule once, reuse it everywhere, and fix it in one place when it needs a change.

Using fragments takes two optional fields inside `prompt`:

- **`fragment_files`** declares the libraries and gives each a short alias. The `url` is either a full `https://` link or a relative path, which is resolved next to your tutor file's own published location.
- **`fragments`** lists which fragments to include and supplies their values under `variables`. A fragment declares which values it needs; required ones must be supplied with the right type, and validation tells you exactly what's missing.

The order of the final prompt comes from each fragment's `priority` (set in the library, lower numbers first), not from the order you list them in. Your `tutor_instructions` are appended after all fragments.

Two things to know before you rely on a library:

- A fragment library has to be reachable at a public web address, just like the tutor file itself. Publishing works the same way for both.
- Validating a tutor also validates every fragment in every library it references, even fragments the tutor doesn't use. A broken template anywhere in the library fails the whole check, which is good news: a shared library that validates once is safe for everyone who uses it.

**When are fragments worth it?** When several tutors should share the same wording: a school-wide safety policy, a Socratic teaching style, a language rule. For a single tutor with instructions nobody else will reuse, plain `tutor_instructions` is simpler and just as good.

## The sample tutor, walked through

The sorting-algorithms tutor (`activities/examples/sorting-algorithms/sorting-tutor.yaml`) pulls four fragments from a shared library and adds its own instructions:

```yaml
prompt:
  fragment_files:
    - id: general_fragments
      url: "../shared/general-fragments.yaml"

  fragments:
    - file: general_fragments
      id: socratic_tutor

    - file: general_fragments
      id: topic_limits
      variables:
        allowed_topics:
          - "Bubble Sort: idea, passes, neighbor comparisons, swaps, early exit when no swap happens"
          - "Selection Sort: idea, finding the minimum in the unsorted part, swapping it to the front"

    - file: general_fragments
      id: language_policy
      variables:
        natural_language: "German"
        code_language: "English (TypeScript and p5.js terms)"

    - file: general_fragments
      id: teenager_safety
      required: true
```

Reading it top to bottom:

1. **One library, one alias.** The library sits in a sibling folder, so a relative `url` is enough; `general_fragments` is the alias the entries below refer to.
2. **`socratic_tutor`** needs no variables: it's a fixed teaching style (hints and questions instead of ready-made solutions) that any subject tutor can reuse unchanged.
3. **`topic_limits`** takes a list of allowed topics, so the same fragment keeps a maths tutor on maths and this one on sorting. The full sample lists seven topics; the excerpt above shows the first two.
4. **`language_policy`** takes two values: the tutor speaks German with the students but keeps code and technical terms in English.
5. **`teenager_safety`** is the shared safety net for teenage students. It needs no values either. The `required: true` flag marks it as important to keep; it's accepted but doesn't change validation today.

After those four fragments, the tutor's own `tutor_instructions` add everything specific to this class: the students' prior knowledge, the learning goals, and how to guide them through visualising the algorithms. That split is the pattern to copy: shared behaviour in fragments, your class in the instructions.
