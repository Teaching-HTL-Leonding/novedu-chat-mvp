---
title: Creating a shared code
description: Turn an activity into a short link for your class, with a note, an availability window, and an optional model override.
sidebar:
  order: 1
audience: teacher
keywords: [code, share link, create code, note, availability window, model override, codes create]
related:
  - 30-sharing-activities/03-time-limitation
  - 30-sharing-activities/04-anonymous-vs-per-user
  - 30-sharing-activities/06-coding-special-case
  - 20-building-activities/02-available-llms
generated: true
---

<!--
  GENERATED FILE, do not edit by hand.
  Edit the chapter prompt in teacher-docs/prompts/30-sharing-activities/01-creating-codes.prompt.md and regenerate.
-->

Once an activity is ready, you hand it to a class as a code: a short link that opens the activity for anyone who has it. Creating one takes a minute, and you can create as many codes for the same activity as you like, for example one per class.

## What you need first

The activity's YAML file must be reachable at a public web address. There are two ways to get one:

- **Host the file yourself**, for example in a public GitHub repository, and use the raw file address.
- **Upload it to Novedu's file store.** Every stored file gets a public address, and the file list offers a **Create code** shortcut that opens the create form with the kind and the address already filled in.

## Create the code

Novedu checks the activity file before storing anything. If the file has errors, the form lists them and no code is created; fix the file and submit again.

1. Open **Codes** and select **New code**.
2. Under **Activity**, pick the kind of activity: tutor, quiz, writing, or coding.
3. Paste the file's address into **Activity YAML URL**.
4. Add a **Note** for yourself, for example "3AHIF linked lists exercise". Only teachers see it; it labels the code in your list.
5. Set **Available from** and **Available until** if the code should only work during a certain time. Both fields use your local time, and either may stay blank to leave that side open. The **Now**, **+1h**, **+1d**, and **+1w** buttons fill common values.
6. Fill in the **LLM override** only if this one code should run on a different AI model than the activity file names. Provider and model always go together (both or neither); the preset buttons fill a known-good pair in one click, and **Clear** removes the override.
7. Select **Create code**.

## What you get

Novedu generates the code text for you, a short random string; you can't choose your own. After creating it you land on the code's page, which shows the full link with a copy button. Share it however you reach your class: paste it into your learning platform, show it on the projector, or write it on the board. Students can also type just the code on the Novedu start page.

A coding code is the one exception: instead of a share link, its page shows the connection settings students enter in their coding tool, because a coding activity is used from a coding assistant, not from a web page.

## What you can change later, and what's fixed

You can reopen any code from the list and edit three things at any time:

- the note,
- the availability window,
- the model override.

Three things are fixed when the code is created and never change: the kind of activity, the activity file's address, and whether the activity records who did what (anonymous or per-user, taken from the activity file at creation time). To share a different file, create a new code.

The code points at your file, not at a copy of it. If you edit the activity file itself, students get the new version the next time they open the link.

## Creating codes from the command line

If you're comfortable with a terminal, the Novedu CLI creates codes too, with the same checks as the web form. Sign in first with `novedu-cli login`, then:

```bash
npx @novedu/cli codes create --module quiz \
  --file https://raw.githubusercontent.com/Teaching-HTL-Leonding/novedu-chat-mvp/refs/heads/main/activities/examples/sorting-algorithms/sorting-quiz.yaml \
  --note "3AHIF sorting quiz" \
  --start 2026-07-07T08:00:00Z --end 2026-07-07T10:00:00Z
```

`--start` and `--end` take ISO 8601 times with an explicit offset (the `Z` above means UTC) and may be left out for an open-ended code. `--llm-provider` and `--llm-model` set the model override, always together. `novedu-cli codes list` shows your codes.
