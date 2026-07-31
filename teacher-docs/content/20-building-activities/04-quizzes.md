---
title: Building a quiz
description: Write a quiz file with open-ended questions and private grading guides, and set shuffling, photo answers, and the follow-up discussion.
sidebar:
  order: 4
audience: teacher
keywords: [quiz, questions, grading, evaluation, rubric, shuffle, photo answer, imageInput, discussion, fragments]
related:
  - 20-building-activities/01-handling-yaml
  - 20-building-activities/02-available-llms
  - 20-building-activities/07-fragments
  - 10-yaml-for-teachers/04-cli-validation
  - 30-sharing-activities/04-anonymous-vs-per-user
generated: true
---

<!--
  GENERATED FILE, do not edit by hand.
  Edit the chapter prompt in teacher-docs/prompts/20-building-activities/04-quizzes.prompt.md and regenerate.
-->

A quiz is an activity made of **open-ended questions**. There is deliberately no multiple choice: students answer in their own words, and the AI grades each answer against a grading guide you write. The student immediately sees a verdict (**correct**, **partial**, or **incorrect**) and written feedback, and can then open a short discussion chat about that question.

You define a quiz in one YAML file. The core is simple: an `id`, a model, and a list of questions.

## One question, two texts

Every question in a quiz file carries two pieces of text with very different audiences:

- **`question`**: the Markdown the student sees. Maths (`$…$`) and code fences render.
- **`evaluation`**: the grading guide. Only the AI sees it; it never reaches the student's browser. Because it stays private, it can openly state the expected answer and the criteria for each verdict.

## The smallest quiz that works

This complete example comes from the quiz authoring guide:

```yaml
id: capitals-basics
name: "Capital Cities — Basics"
title: "Capitals Quiz"
description: "A short quiz on capital cities. Answer in your own words."
anonymous: false # record which student each attempt belongs to
shuffle: true # random question order per attempt
llm:
  model: RedHatAI/gemma-4-31B-it-FP8-Dynamic
questions:
  - id: capital-australia
    title: "Capital of Australia"
    question: |
      What is the **capital city of Australia**?
    evaluation: |
      The correct answer is **Canberra**.

      Grade as:
      - `correct`   — names Canberra (any reasonable spelling).
      - `partial`   — mentions Canberra among other guesses, or describes it.
      - `incorrect` — names Sydney, Melbourne, or any other city.
```

Field by field:

- **`id`** (required): a short machine name for the quiz.
- **`name`** (optional): a human-readable label.
- **`title`** and **`description`** (optional): what students see on the welcome screen before the first question. Write the `description` for your students.
- **`anonymous`** (optional, default `true`): by default a quiz is anonymous, so answers feed the statistics but aren't linked to a student. Set `anonymous: false` to attribute each attempt to the signed-in student. The setting is frozen onto a code when you create one; editing the file later doesn't change a live code.
- **`shuffle`** (optional, default `true`): questions appear in a random order per attempt. Set `shuffle: false` to keep your authored order.
- **`llm.model`** (required): the model that grades the answers and drives the discussion chat. You can also set an optional `llm.provider` (the provider decides where the AI runs); the create-code form can override both per code.
- **`questions`** (required): at least one question. Each needs an `id` (unique within the quiz), a `question`, and an `evaluation`; an optional `title` labels it in the statistics and progress display.

## Writing grading guidance that works

The `evaluation` is the heart of a question. The AI maps the student's answer onto one of three verdicts, so name all three explicitly: describe what counts as `correct`, what still earns `partial`, and what is `incorrect`. Vague guidance produces vague grading.

A pattern that works well:

1. State the expected answer first, including acceptable variants.
2. List the three verdicts with concrete criteria for each.
3. Tell the AI how to write the feedback: which language to use, and whether to show a worked example or a gentle correction.

Since students never see the grading guide, you don't need to hide anything in it. Spell out the full solution, common wrong answers, and how generous to be with spelling or phrasing.

## Question order

Questions are shuffled by default: each student gets a random order per attempt. Set `shuffle: false` at the top of the file when later questions build on earlier ones, as the sorting-algorithms sample quiz does (it moves from concept to code step by step).

## Photo answers

Students can attach photos of their work, for example a handwritten calculation, when you turn photo answers on:

```yaml
llm:
  model: RedHatAI/gemma-4-31B-it-FP8-Dynamic
  imageInput: true
```

Photo answers are **off by default**. A few things to know:

- The model must be **vision-capable** (able to look at images). That also applies to any per-code model override on such a quiz.
- Students can attach up to three photos per answer, 5 MB each. An answer may even be photo-only, with no typed text.
- The quiz-level flag is the default for all questions; an `imageInput` on a single question overrides it in either direction.

## The follow-up discussion

After seeing their feedback, a student can open a short discussion chat about that question. Novedu already gives the assistant full context (the question, the expected answer, the student's answer, and the verdict), so the optional `discussion.instructions` field is only extra steering: tone, language, and didactic style. Omit it to use a sensible default.

## Reusing fragments in a quiz

A quiz can place shared prompt fragments, the same reusable pieces tutors use (a persona, a safety policy, a language rule). Declare the library under a top-level `fragment_files:`, then place each fragment with a marker in a top-level `instructions:` field:

```yaml
fragment_files:
  - id: general_fragments
    url: "../shared/general-fragments.yaml"

instructions: |
  {{fragment "general_fragments.teenager_safety"}}
```

A quiz's `instructions` field reaches further than the instructions of other activities: it applies **both** to how answers are graded **and** to the follow-up discussion chat, so a shared safety or persona rule shapes grading and conversation alike. It is a separate field from `discussion.instructions`, which only steers the discussion. The chapter on reusable fragments covers writing a library and supplying values.

## A real example: the sorting-algorithms quiz

The sample file `activities/examples/sorting-algorithms/sorting-quiz.yaml` is a seven-question quiz for a TypeScript class, and it shows most of the options above in action. Its header keeps the authored order and steers the discussion chat:

```yaml
id: sorting-algorithms-quiz
name: "Quiz: Bubble Sort & Selection Sort"

# The questions build up from concept to code, so keep the authored order.
shuffle: false

llm:
  model: RedHatAI/gemma-4-31B-it-FP8-Dynamic

discussion:
  instructions: |
    You are a friendly programming tutor helping the student understand THIS
    quiz question about sorting algorithms. The student has already submitted
    an answer, so you may reveal and explain the correct answer. ...
    Respond in German, keep code and identifiers in English, and stay on the
    topic of this question.
```

One question turns photo answers on just for itself, because a handwritten trace on paper is the natural way to answer it:

```yaml
  - id: bubble-trace
    title: "Bubble Sort von Hand"
    imageInput: true
    question: |
      Gegeben ist das Array `[5, 2, 4, 1]`.

      Wie sieht das Array nach dem **ersten vollständigen Durchlauf** von
      Bubble Sort aus ...
```

Its grading guide states the full solution and even anticipates a typical wrong answer, grading it `partial` rather than `incorrect`:

```yaml
    evaluation: |
      Die korrekte Antwort ist **`[2, 4, 1, 5]`** ...

      Bewerte als:
      - `correct`   — das Ergebnis `[2, 4, 1, 5]` (mit oder ohne
                      Zwischenschritte).
      - `partial`   — ... ODER die Antwort ist das fertig sortierte Array
                      `[1, 2, 4, 5]` (zu weit gedacht: das ist das Ergebnis
                      ALLER Durchläufe, nicht des ersten).
      - `incorrect` — ein anderes Ergebnis ohne erkennbar richtiges Vorgehen.

      Gib das Feedback auf Deutsch und zeige die drei Vergleichsschritte.
```

Notice the mix of languages: the questions and feedback instructions are in German for the students, while field names and code stay in English. Write your quiz in whatever language your class works in; the grading works the same way.

## Before you share a quiz

Validate the file before you hand out a link: an invalid quiz cannot be saved in the app or turned into a code. The validator checks that the YAML parses, that the structure is right (an `llm.model` and at least one question, each with an `id`, a `question`, and an `evaluation`), and that every question `id` is unique. From the terminal:

```bash
novedu-cli validate ./quizzes/my-quiz.yaml --kind quiz
```
