---
title: Let your AI assistant read this guide
description: Where the machine-readable form of the teacher guide lives, and how to point an AI assistant at it.
sidebar:
  order: 2
audience: teacher
keywords: [llms.txt, AI assistant, agent, Markdown, machine-readable docs, ChatGPT, Claude, Copilot]
related:
  - 40-ai-llms/01-novedu-cli
---

You read this guide as web pages. An AI assistant reads it more easily in another form: plain Markdown, the simple text format that assistants handle well. Novedu publishes the guide in that form too, following the llms.txt convention, an industry-wide way for websites to offer their documentation to AI tools. When your assistant has read the guide, its answers about Novedu come from the same chapters you use, not from guesswork.

## Three addresses

The machine-readable guide is public and needs no sign-in, just like the pages you are reading. It lives at three kinds of addresses:

- **The table of contents: <https://novedu.at/docs/llms.txt>.** It lists every chapter with a one-line description and a link to that chapter as a Markdown file. This is the best first link to hand an assistant, because it can pick out just the chapters it needs.
- **The whole guide in one document: <https://novedu.at/docs/llms-full.txt>.** Every chapter, in reading order. Use it when the assistant should know everything at once. It is a lot of text, so for a specific question the table of contents is the better start.
- **Any single chapter: append `.md` to its page address.** For example, the page <https://novedu.at/docs/30-sharing-activities/01-creating-codes/> becomes the Markdown file <https://novedu.at/docs/30-sharing-activities/01-creating-codes.md>. This works on the guide's chapter pages only, not on other pages of Novedu.

## What the assistant gets

The Markdown files carry this guide's own text, word for word. They are not a summary and not a separate export that can fall behind: they are published together with the guide, so when a chapter changes, its machine-readable twin changes with it.

## Hand it to your assistant

The simplest way is to paste an address into the conversation together with your question, for example: "Read https://novedu.at/docs/llms.txt and then help me build my first quiz." An assistant that can fetch web pages (many can, such as ChatGPT, Claude, or Copilot, depending on how they are set up) follows the chapter links on its own and reads what it needs.

If your assistant cannot fetch web pages, open <https://novedu.at/docs/llms-full.txt> in your browser, copy the text, and paste it into the conversation instead.

## Reading and doing

The machine-readable guide covers the reading half: an assistant that has read it can explain how Novedu behaves. The doing half is the Novedu AI skill, which teaches an assistant to run the Novedu CLI for you: checking activity files, creating codes, and the rest of the teacher work. The two combine naturally. Install the skill, hand your assistant the guide, and it can both explain Novedu and act on it.
