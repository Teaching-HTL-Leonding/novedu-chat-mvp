---
title: Building a coding activity
description: Write a coding activity's YAML with an id, a pinned AI model, and instructions that keep the assistant within what your class has learned.
sidebar:
  order: 6
audience: teacher
keywords: [coding activity, coding assistant, instructions, model, little-coder, YAML, coding buddy, fragments, sample solution, text_files]
related:
  - 00-introduction/06-coding-overview
  - 20-building-activities/02-available-llms
  - 20-building-activities/07-fragments
  - 30-sharing-activities/06-coding-special-case
  - 10-yaml-for-teachers/04-cli-validation
generated: true
---

<!--
  GENERATED FILE, do not edit by hand.
  Edit the chapter prompt in teacher-docs/prompts/20-building-activities/06-coding.prompt.md and regenerate.
-->

A coding activity gives your class an AI coding assistant that behaves the way you decide. Students work in their own coding tool on their own machine; your YAML file only tells Novedu which model answers and what rules the assistant follows. It is the smallest activity file of all: an id, a model, and your instructions.

## The fields

A coding file has one required trio and two optional labels:

```yaml
# yaml-language-server: $schema=https://raw.githubusercontent.com/Teaching-HTL-Leonding/novedu-chat-mvp/refs/heads/main/activities/coding/coding-yaml.schema.json
id: sorting-visualizer
name: "Sorting Visualizer — TypeScript + p5.js"
title: "Sortieren sichtbar machen (TypeScript + p5.js)"
llm:
  model: RedHatAI/gemma-4-31B-it-FP8-Dynamic
instructions: |
  You are a friendly coding buddy for 16-year-old vocational-college students.
  ...
```

- **`id`** (required): a short machine name for the activity.
- **`name`** (optional): a human-readable label for you.
- **`title`** (optional): the heading students see on the connection page when they open the activity's code link.
- **`llm.model`** (required): the model that answers. You can also add `llm.provider` to run on Azure instead of the school's Austrian LLM hosting partner, and `llm.reasoning` to set how hard the model thinks before it answers; the same `llm:` block works here as in every other activity.
- **`instructions`** (required): the assistant's rules, written by you.

The first comment line is an editor hint: with a YAML-aware editor such as VS Code with the Red Hat YAML extension, it turns on validation and autocompletion while you type.

## The model is yours to pin

The `llm.model` you write is final. A student's coding tool always sends some model name of its own, but Novedu ignores it and answers with the model you chose. Students never need to know which model runs, and they cannot switch to another one. A `reasoning` level is pinned in the same way: it replaces whatever thinking effort the student's tool asks for, and if you set none, the tool's own request goes through. When you later create a code for the activity, you can override these settings for that one code without editing the file.

## Instructions shape the assistant

The `instructions` field is the assistant's rulebook, a prompt in plain language. Students never see the text; they only notice its effect in every answer the assistant gives. Your rules also outrank anything the student's coding tool tells the model, so they hold even when the tool has ideas of its own.

The most useful thing to write is what your class may use, so the assistant's help never runs ahead of the lessons:

- **The language and its subset.** For example: only `number`, `string`, `boolean`, and arrays; no classes, no arrow functions; plain loops instead of `map` or `filter`.
- **The topic.** Tell the assistant to help only with the current project and to politely decline unrelated homework.
- **The teaching style.** Small steps, explain why, short runnable fragments, comments that explain the idea.
- **What the student must do alone.** If the algorithm is the learning goal, forbid generating it whole and ask the assistant to guide instead.

## Reusing fragments in a coding activity

A coding activity can place shared prompt fragments, the same reusable pieces tutors use (a persona, a safety policy, a language rule). Declare the library under a top-level `fragment_files:`, then place each fragment with a marker in your `instructions`:

```yaml
fragment_files:
  - id: general_fragments
    url: "../shared/general-fragments.yaml"

instructions: |
  {{fragment "general_fragments.teenager_safety"}}

  You are a friendly coding buddy ...
```

A fragment lands where its marker sits, so a school-wide rule can frame the coding assistant at the top of your `instructions` without you repeating it in every activity. The chapter on reusable fragments covers writing a library and supplying values.

## Embedding your sample solution

A coding activity can also embed a plain-text file, and the classic use is the teacher's sample solution. Declare the file under a top-level `text_files:` (a short alias plus a web address, for example the raw GitHub address of your reference implementation), then place it in your `instructions` with a `{{file}}` marker:

````yaml
text_files:
  - id: solution
    url: https://raw.githubusercontent.com/rstropek/htl-2025-26-2nd/refs/heads/main/40-classes/LinkedListWithTests/src/linkedList.ts

instructions: |
  ## The sample solution — your private reference, NOT a handout
  Below is the teacher's reference implementation. Use it to recognise when a
  student is on the right track and to give precise, minimal nudges toward it.

  Hard rule: NEVER paste this class — or any complete method body from it — back
  to the student.

  ```typescript
  {{file "solution"}}
  ```
````

The file is inserted exactly as fetched, so your source code arrives unchanged. Because students never see the `instructions`, the assistant knows the exact target shape (method names, signatures, return conventions) and can guide towards it without ever handing it out. The repository ships a complete example of this pattern at `activities/examples/linked-lists/linked-list-buddy.yaml`, a linked-list exercise whose assistant carries the sample solution as its private reference. The chapter on reusable fragments covers the general text-file rules, including embedding just a line range of a file.

## What a coding file does not have

Coding files deliberately leave out fields you may know from tutors, quizzes, and writing activities:

- **No `anonymous` field.** Coding activities are always anonymous: requests carry no student identity, and nothing is recorded per student.
- **No `placeholder` and no `description`.** There is no in-app chat window to show them in; students work in their own tool.

Do not add any of the three. Validation rejects a coding file that contains them, so a leftover field from a copied tutor is caught before students are affected. You can check a file at any time with the Novedu CLI (`novedu-cli validate my-coding.yaml --kind coding`) or with the **Validate** button on the app's YAML Files page.

## A real example: the sorting visualizer

The repository ships a complete coding activity at `activities/examples/sorting-algorithms/sorting-visualizer.yaml`. The class is building a Bubble Sort and Selection Sort visualiser in TypeScript and p5.js, and the file shows all four instruction ideas in action.

It states what the class already knows, so the assistant assumes nothing more:

```yaml
instructions: |
  ## What the students already know
  - TypeScript basics: functions, loops (`for`, `for...of`, `while`),
    conditions (`if` / `else if` / `else`), variables with `let` and `const`,
    the basic types `number`, `string`, `boolean`, and arrays of those.
```

It fences in the language, so generated code stays readable for beginners:

```yaml
  ## TypeScript limits — stay inside them
  - Use only `number`, `string`, `boolean`, and simple arrays of those. No
    classes, no interfaces, no enums, no generics, no union types, no
    destructuring, no `async`/`await`.
  - Write plain loops. Do NOT use `map`, `filter`, `reduce`, or `sort` —
    writing the sorting loop themselves is the whole point of this project.
```

And it protects the learning goal: the assistant may freely build the scaffolding (canvas, bars, keyboard events) but must never write the sorting algorithm itself. Instead it explains the next step, shows a tiny isolated fragment, and lets the student assemble the loop:

```yaml
  ## The algorithm is the learning goal — don't write it for the student
  - The comparison-and-swap logic of Bubble Sort and Selection Sort is what
    the students must write THEMSELVES. Never generate a complete, working
    sorting function on request.
```

Copy this file, replace the project and the limits with your own, and you have a working coding activity.

## Students bring their own tool

Unlike a tutor or a quiz, a coding activity has no chat inside Novedu. Students connect an external coding agent (for example little-coder) to the activity: the code you share doubles as their access key, and the code's link page shows them ready-to-copy connection settings. Creating the code and getting a class connected is its own topic, covered in the chapter on sharing coding activities.
