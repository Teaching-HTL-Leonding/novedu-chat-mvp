---
title: Reusable fragments
description: Write a fragment library once and reuse the same prompt pieces in tutors, quizzes, writing, and coding activities.
sidebar:
  order: 7
audience: teacher
keywords: [fragment, fragment library, fragments, fragment_files, variables, input_schema, priority, default, reuse, prompt]
related:
  - 20-building-activities/03-tutors
  - 20-building-activities/04-quizzes
  - 20-building-activities/05-writing
  - 20-building-activities/06-coding
  - 20-building-activities/01-handling-yaml
  - 10-yaml-for-teachers/04-cli-validation
generated: true
---

<!--
  GENERATED FILE, do not edit by hand.
  Edit the chapter prompt in teacher-docs/prompts/20-building-activities/07-fragments.prompt.md and regenerate.
-->

A [[fragment]] is a named piece of [[prompt]] (a teaching style, a safety policy, a language rule) that lives in a fragment library, a [[YAML]] file of its own. Write the rule once, pull it into as many activities as you like, and fix it in one place when it needs a change. The chapter on building a tutor shows how to *use* fragments; this chapter shows how to *write* a library of your own, and how the same library serves every kind of [[activity]].

## One library, four kinds of activity

Fragments aren't a tutor feature. A tutor, a quiz, a writing activity, and a coding activity can all pull fragments from the same library, so a school-wide safety policy written once really does cover everything you build. Two things differ by kind:

- **Where the block goes.** A tutor declares `fragment_files` and `fragments` inside its `prompt:` section. A quiz, writing, or coding activity declares the same two fields at the top level of the file, next to `id` and `name`.
- **What the fragments frame.** The assembled fragments always come first, and the activity's own text follows: a tutor's `tutor_instructions`, or the `instructions` of a quiz discussion, writing, or coding activity. In a quiz the fragments reach further than you might expect: they apply both to how answers are graded and to the follow-up discussion chat, so a persona or safety rule shapes grading and conversation alike.

Here's a quiz pulling the shared safety fragment from the example library, with the block at the top level of the quiz file:

```yaml
fragment_files:
  - id: general_fragments
    url: "../shared/general-fragments.yaml"

fragments:
  - file: general_fragments
    id: teenager_safety
```

## What a library file looks like

A fragment library is a YAML file with an `id` and a list of fragments. Here's a small, complete library with two fragments:

```yaml
id: simple-fragments
fragments:
  - id: persona
    version: 1
    priority: 100
    input_schema:
      type: object
      required:
        - subject
      properties:
        subject:
          type: string
        greeting:
          type: string
          default: "Hi there!"
    content: |
      {{greeting}}

      You are a friendly, encouraging tutor for {{subject}}.

  - id: ground_rules
    version: 1
    priority: 200
    input_schema:
      type: object
      required:
        - rules
      properties:
        rules:
          type: array
          items:
            type: string
    content: |
      Follow these ground rules:
      {{#each rules}}
      - {{this}}
      {{/each}}
```

Each fragment carries five fields:

- **`id`** names the fragment; it must be unique within the library, and it's what an activity refers to.
- **`version`** is a number you raise when you change the fragment meaningfully. It's for you and your colleagues to track changes; it doesn't change how the fragment behaves today.
- **`priority`** decides where the fragment lands in the final prompt. Lower numbers come first.
- **`input_schema`** declares the values the fragment expects. Leave it out for a fragment that takes no values.
- **`content`** is the prompt text itself, written as a template.

A fragment may also carry a `classification` label, for example to mark a safety piece. It's a note for readers of the library; it doesn't change validation or behaviour today.

A larger, real library is `activities/examples/shared/general-fragments.yaml`: a Socratic teaching style, a topic limiter, a language policy, and a safety net for teenage students, reused across the sample activities of every kind.

## Writing the content

The `content` field is a template (the Handlebars format, if you want to look it up). You only need three constructs:

**Insert a value** with `{{name}}`:

```yaml
content: |
  You are a tutor for {{subject}}.
```

**Loop over a list** with `{{#each}}`, using `{{this}}` for the current item:

```yaml
content: |
  Follow these ground rules:
  {{#each rules}}
  - {{this}}
  {{/each}}
```

**Show text only when a flag is off** with `{{#unless}}`:

```yaml
content: |
  {{#unless allow_solution}}
  Do not give away the full solution.
  {{/unless}}
```

Text is inserted exactly as written: characters like `<`, `>`, and `&` survive, so small ASCII diagrams such as `[A] -> [B]` come through unchanged. One rule to respect: every `{{variable}}` the content uses must be declared in the fragment's `input_schema`. A variable the fragment never declares fails validation.

## Declaring values, and defaults

The `input_schema` block declares what a fragment needs. Three value types are supported:

| `type` | Meaning | Example value |
| --- | --- | --- |
| `string` | A piece of text | `subject: "fractions"` |
| `boolean` | `true` or `false` | `allow_solution: false` |
| `array` (of `string`) | A list of text items | `rules: ["…", "…"]` |

Inputs listed under `required` must be supplied by every activity that uses the fragment, with the right type; validation names exactly what's missing or mismatched. Supplying a value the fragment doesn't declare isn't an error, but it draws a warning, because it usually means a typo.

An optional input can carry a **`default`**, used whenever the activity leaves the value out. In the `persona` fragment above, an activity that sets no `greeting` gets "Hi there!"; an activity that supplies one gets its own text, because a supplied value always wins. Two details worth knowing:

- A default must match its declared type: a text default on a `boolean` input is rejected.
- A default on a *required* input can never apply, since the value must be supplied anyway. The validator flags that combination with a warning.

Defaults are what make a fragment pleasant to reuse: the common case needs no values at all, and the unusual class overrides just the one value it cares about.

## How the final prompt is ordered

The order you list fragments in an activity file doesn't matter. Each included fragment renders with its values, the results are sorted by `priority` (lowest first), and the activity's own instructions are appended last. The pieces are joined with blank lines into one prompt.

Because `priority` alone decides the order, two fragments used by the same activity must not share a priority, and that holds even when the fragments come from two different libraries. Validation rejects the activity as ambiguous. If you maintain a library others combine with theirs, it helps to publish which priority ranges you use, the way the shared example library spaces its fragments at 100, 200, 400, and 900 so tutors can slot their own pieces in between.

## Validating a library

You can validate a fragment library on its own, before any activity uses it: on the app's Validate page, switch the selector to **Fragment library** and paste the library's address, or run the CLI with `--kind fragment`. The check confirms the file's structure, that fragment ids are unique, and that every fragment's content renders against its own declared inputs, so a typo in a template surfaces before a colleague's activity trips over it.

Validating or sharing an *activity* runs the same thorough check over every fragment in every library the activity references, even fragments it doesn't use. A library that validates once is safe for everyone who builds on it.

One safety property to rely on: fragments never vanish silently. If a library can't be loaded or a fragment fails when a student opens the activity, the activity refuses to start rather than running without the missing rules. A safety policy you declared is either in effect or the activity doesn't run.

## Hosting a library

A fragment library is hosted like any other activity file: at a public web address (for example a raw GitHub URL), or as a file hosted in the app itself on the **Files** page, which is the easiest route when you don't want to touch GitHub. Publishing works the same way for libraries and activities.

An activity references a library by URL, and the URL may be relative: a plain path like `../shared/general-fragments.yaml` resolves next to the activity file's own published location. Keep a library next to the activities that use it and the references stay short. When the files live on GitHub, remember to commit and push the library before validating; the server reads the published version, not your local copy.
