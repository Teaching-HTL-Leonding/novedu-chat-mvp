---
title: Building a writing activity
description: Write the YAML for a writing activity, describe the task, shape a coach that advises without rewriting, and add an optional starter scaffold.
sidebar:
  order: 5
audience: teacher
keywords: [writing activity, writing coach, instructions, placeholder, scaffold, feedback, anonymous, getCurrentText, fragments]
related:
  - 00-introduction/05-writing-overview
  - 20-building-activities/02-available-llms
  - 20-building-activities/07-fragments
  - 30-sharing-activities/04-anonymous-vs-per-user
  - 10-yaml-for-teachers/04-cli-validation
generated: true
---

<!--
  GENERATED FILE, do not edit by hand.
  Edit the chapter prompt in teacher-docs/prompts/20-building-activities/05-writing.prompt.md and regenerate.
-->

A writing [[activity]] gives each student a split screen: an editor on the left where they write, and an AI writing coach on the right that gives feedback on their draft. The coach can read the draft at any time, but it has no way to change it. It only advises; the student writes every sentence. When students are happy with their text, they press **Save**, and you can review one saved text per student later.

You describe the task and how the coach should behave in a [[YAML]] file. The editor, the coach's read access to the draft, and the Save button are all built in.

## The smallest working file

Three things are required: an `id`, an AI model, and the coach's instructions.

```yaml
id: my-essay
llm:
  model: RedHatAI/gemma-4-31B-it-FP8-Dynamic
instructions: |
  You are an encouraging writing coach. Help the student improve THEIR essay,
  never write it for them. Read the current draft with the `getCurrentText` tool
  before giving feedback. Point at what works and what to improve, and end with
  a concrete next step.
```

- `id` is a short machine name for the activity, such as `my-essay`.
- `llm.model` picks the AI model that drives the feedback chat. It works the same as in tutors and quizzes, and a [[code]] can override it later without touching the file.
- `instructions` is the coach's [[prompt]]: how it should behave, what to look for, and how to talk to the student. Students never see this text, so you can spell out your assessment criteria freely.

## The task students see

Two optional fields set the assignment on the welcome screen, before the student starts writing:

- `title` replaces the default greeting. Leave it out to keep the default.
- `description` appears below the greeting and supports Markdown. This is where you state the actual writing task: the situation, the text type, the length, and what the text must contain. Write it for your students.

A third optional field, `placeholder`, is starter text prefilled into the editor. Leave it empty (`""`) for a blank page, or give the text a scaffold: headings, a formal opening line, or bracketed hints for each paragraph. A scaffold shows students the expected shape while they still write every sentence themselves.

## Shaping the coach

The coach cannot edit the student's text. Its only access to the draft is a read-only tool called `getCurrentText`, so even instructions that asked it to rewrite would have no effect. Write the instructions to fit a read-only helper:

- **Tell it to read before it comments.** Ask it to call `getCurrentText` before giving feedback, and again whenever the student says they changed something, so it never guesses at the draft.
- **Advise, don't rewrite.** Tell it to point at what works and what doesn't, explain why, and give a direction or a guiding question rather than finished sentences. Short model phrases ("I would suggest ...") are fine; whole sentences about the student's own topic are not.
- **Set priorities.** List what to give feedback on, in order, so the coach raises the one or two most important improvements instead of everything at once. Putting grammar last keeps the focus on the writing task.
- **Set the tone.** Say who the student is (age, language level) and how to talk to them, for example in simple English with difficult words explained.
- **Cover the empty page.** Tell the coach what to do when the draft is empty or very short: help the student start with questions instead of critiquing.

## Reusing fragments in a writing activity

A writing activity can pull in shared prompt [[fragment|fragments]], the same reusable pieces tutors use (a persona, a safety policy, a language rule). Declare them at the top level of the file, next to `id` and `instructions`:

```yaml
fragment_files:
  - id: general_fragments
    url: "../shared/general-fragments.yaml"

fragments:
  - file: general_fragments
    id: teenager_safety
```

The assembled fragments come first and your `instructions` follow, so a school-wide rule frames the coach without you repeating it in every activity. The chapter on reusable fragments covers writing a library and supplying values.

## Recording who wrote what

Writing activities record the author by default, because reviewing saved texts only makes sense when you know whose text it is. This is different from tutors and quizzes, which default to anonymous.

You can set `anonymous: true` for ephemeral, unattributed writing, but then saving is turned off: there is nothing to keep or review. The [[anonymous vs. per-user|anonymous]] setting is frozen onto the code when you create it.

## A real example: the restaurant review letter

The sample activity `activities/examples/review-writing/restaurant-review-letter.yaml` is a complete writing activity for an English class: a formal feedback letter (150 to 250 words) to a restaurant manager after a birthday party there. It shows all the pieces working together.

**The description sets the scene and the requirements.** It gives the student a concrete situation, what went well and what went wrong, and a checklist for the letter:

```yaml
title: "Write a Feedback Letter to the Restaurant"
description: |
  Last Saturday you celebrated your **birthday party** with eight friends at
  the restaurant *Bella Vista*. Some things were great: the pizza was
  delicious and the staff sang for you. Some things were not: you had booked
  a table for 7 p.m. but waited 30 minutes, and the drinks were expensive
  and arrived slowly.

  Write a **feedback letter (150–250 words)** to the restaurant's manager.
  You don't know the manager's name. Your letter should:

  - open and close like a **formal letter**,
  - say **why** you are writing,
  - mention what you **liked** and what **disappointed** you — politely,
  - end with a **suggestion** for improvement.
```

**The placeholder is a formal-letter scaffold.** The student sees the expected shape but writes every sentence:

```yaml
placeholder: |
  Dear Sir or Madam,

  (Why are you writing? When were you at the restaurant, and what was the occasion?)

  (What did you like? Be specific.)

  (What disappointed you? Stay polite.)

  (What do you suggest the restaurant should improve?)

  Yours faithfully,
  (your name)
```

**The instructions shape a read-only coach with clear priorities.** They tell the coach to read the draft with `getCurrentText` before every piece of feedback, never to hand over finished sentences, to quote the student's own words when praising or questioning, and to raise only the one or two improvements that matter most. Then they rank what to look at: task fulfilment first, then structure, then register and tone (the heart of this unit), then concreteness, language variety, and grammar last. They also say what to do with an empty draft: help the student start with questions about the party.

The full file is worth copying as your starting point; swap in your own task, scaffold, and priorities.
