---
title: "Sharing a coding activity: the code is the key"
description: A coding code is not a web page but an access key students paste into their coding tool; what to hand out, and why coding is always anonymous.
sidebar:
  order: 6
audience: teacher
keywords: [coding, code, API key, connection, base URL, little-coder, models.json, anonymous]
related:
  - 30-sharing-activities/01-creating-codes
  - 30-sharing-activities/04-anonymous-vs-per-user
  - 30-sharing-activities/02-viewing-usage
  - 20-building-activities/06-coding
  - 00-introduction/06-coding-overview
generated: true
---

<!--
  GENERATED FILE, do not edit by hand.
  Edit the chapter prompt in teacher-docs/prompts/30-sharing-activities/06-coding-special-case.prompt.md and regenerate.
-->

Sharing a coding [[activity]] works differently from every other kind. A tutor, quiz, or writing [[code]] opens a page in Novedu where the student works. A coding code opens nothing to chat with: students work in their own coding tool on their own machine, and the code is the key that connects that tool to your activity.

## The code is a key, not a page

When a student opens a tutor code's link, a chat appears. When a student uses a coding code, nothing runs inside Novedu. Instead, the student pastes the code into an external coding assistant, for example [little-coder](https://github.com/itayinbarr/little-coder), where it acts as the API key. From then on, every question the assistant asks the AI travels through your activity: Novedu checks the code, adds your instructions, and answers with the model you chose.

Because the code works like a key, treat it like one: hand it only to the class it is meant for, and set an availability window if the activity should work only during your lessons. Outside the window the key simply stops answering, exactly as other codes stop opening.

## What to give students

You create a coding code the same way as any other code. The difference comes right after: instead of a share link, Novedu shows connection details. The same details appear on the code's detail page whenever you need them again, and students who open the code's link with their school account see them too.

Give your class three things:

1. **Which tool to use.** For example little-coder; any coding assistant that speaks the common OpenAI-compatible protocol works.
2. **The connection details** from the code's page: the server address (base URL), the code as the API key, and a model name. Each has a copy button, and for little-coder there is a ready-to-paste configuration file (`models.json`) plus a run command, so setup is copy, save, run.
3. **The reassurance that the model is already set.** The model name in the settings is only a label for the tool. Novedu always answers with the model you pinned, whatever the student's tool asks for, so students never need to pick or know the real model.

Your instructions travel the same way: they are applied to every answer on the server, students never see them, and they cannot switch them off, even if their tool sends its own instructions.

## Coding is always anonymous

Coding activities record no student identity. There is no per-student list, no conversations to review, and no way to see who asked what; the code's detail page shows the pinned model, your instructions, and the connection details instead of chats. This is fixed: the coding activity file has no `anonymous` field to change.

What you do see is overall usage. The usage dashboard shows how much a coding code has been used in total (for example token counts over time), which tells you whether the class is working with the assistant without telling you anything about an individual student.
