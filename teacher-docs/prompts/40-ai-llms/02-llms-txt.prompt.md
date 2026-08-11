# The guide for AI agents (llms.txt)

Output: teacher-docs/content/40-ai-llms/02-llms-txt.md · order 2

Job: A teacher who works with an AI assistant and wants its answers about Novedu to
match this guide. After this chapter they know the guide has a machine-readable form,
the exact addresses it lives at, and how to hand it to an assistant.

Cover:
- The guide is published in a form AI assistants read well: plain Markdown at fixed
  addresses, following the llms.txt convention (a widely used way for websites to
  offer their documentation to AI tools).
- The three addresses: the llms.txt table of contents (every chapter with a one-line
  description and a link to that chapter as Markdown), llms-full.txt (the whole guide
  as one document), and appending .md to any chapter page address to get that one
  page as Markdown.
- What the assistant gets: the guide's own text, word for word, not a summary or an
  export. It is published together with the guide, so it is as current as the pages.
  No sign-in, public like the guide itself.
- How a teacher actually uses it: paste an address into the conversation along with
  the question ("Read ... and help me build my first quiz"). An assistant that can
  fetch web pages follows the chapter links itself; for one that cannot, paste the
  content of llms-full.txt.
- How this pairs with the AI skill: the skill teaches an assistant to *do* teacher
  work with the CLI; the machine-readable guide lets it *read* how Novedu behaves.
  One sentence of contrast, no duplication of the skill chapter.

Get right:
- The exact public addresses on the novedu.at origin: /docs/llms.txt,
  /docs/llms-full.txt, and a real chapter address as the .md example. Verify them
  against the current docs-site sources, don't quote from memory.
- Appending .md works on the guide's chapter pages only, not on other pages of the
  Novedu app.
- llms-full.txt is the entire guide in one document, which is a lot of text; llms.txt
  lets the assistant pick just the chapters it needs. Present that as the practical
  difference, without byte or token numbers (they go stale).
- Don't promise what any specific assistant can do. Phrase abilities as "an assistant
  that can fetch web pages", and name products only as examples, never as a complete
  or guaranteed list.
- The convention is written llms.txt, lowercase, and it is an industry convention,
  not a Novedu invention.
- No internals: nothing about how the site is built, no repository paths, no file or
  route names beyond the public addresses themselves.

Look: docs/teacher-docs.md (the llms.txt surface, behavior only),
teacher-docs-site/README.md (what each address serves), https://llmstxt.org
(the convention).
