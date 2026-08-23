# Chapters (information architecture)

The chapter list **is** the IA. Module-spine reference corpus for now; a
jobs-to-be-done `recipes/` track can come later, seeded from real teacher questions.

This manifest is also the **map for keeping docs current**: given a code change, an
agent reads the git diff and uses the "Where to look" column to judge which chapters
a change plausibly affects, then patches those. That reasoning replaces any
per-chapter source list in the docs themselves.

## 00: Introduction
_What Novedu is. Concepts and pedagogy, no deep configuration detail._

| # | Chapter | Where to look (hints) |
| --- | --- | --- |
| 01 | What is Novedu | `README.md`, `activities/README.md`, `activities/tutors/README.md` |
| 02 | What is a shareable code | `docs/codes.md` (behavioral parts), `README.md` |
| 03 | Tutors overview | `activities/tutors/README.md` |
| 04 | Quizzes overview | `activities/quizzes/README.md` |
| 05 | Writing overview | `activities/writings/README.md` |
| 06 | Coding overview | `activities/coding/README.md` |

## 10: YAML for teachers
_Enough YAML, tooling, and validation to author activities confidently._

| # | Chapter | Where to look (hints) |
| --- | --- | --- |
| 01 | The idea behind YAML | `activities/README.md`, module `README.md`s |
| 02 | YAML 101 | `activities/examples/**`, `activities/tutors/README.md` |
| 03 | JSON schemas in your editor | `activities/**/README.md` (modeline), the schema files, `https://github.com/redhat-developer/vscode-yaml` |
| 04 | Validating with the CLI | `cli/README.md`, `.agents/skills/novedu-tutor-cli/SKILL.md` |
| 05 | See the exact prompt | `cli/README.md` (`prompts`), the "See the exact prompt" section of each module `README.md` under `activities/`, `.agents/skills/novedu-tutor-cli/SKILL.md` |
| 06 | Testing how a quiz grades | `activities/evals/README.md`, the "Testing the grading itself" section of `activities/quizzes/README.md`, `cli/README.md` (`eval`), `docs/cli-eval.md` (behavior only), `.agents/skills/novedu-tutor-cli/SKILL.md` |
| 07 | Testing how a tutor answers | the "Tutor evals" section of `activities/evals/README.md`, `activities/tutors/README.md` (tools), `cli/README.md` (`eval`), `docs/cli-eval.md` (behavior only), `.agents/skills/novedu-tutor-cli/SKILL.md`, `activities/examples/sorting-algorithms/**` |

## 20: Building activities
_What makes each activity, field by field, the YAML reference backbone._

| # | Chapter | Where to look (hints) |
| --- | --- | --- |
| 01 | Publishing your YAML (GitHub or upload) | `docs/files.md` (behavior), `cli/README.md` (`files`), `activities/README.md` |
| 02 | Available AI models | `docs/ai-models.md` (teacher-visible parts), `activities/README.md` |
| 03 | Building a tutor | `activities/tutors/README.md`, `activities/examples/**` |
| 04 | Building a quiz | `activities/quizzes/README.md`, `activities/examples/**` |
| 05 | Building a writing activity | `activities/writings/README.md`, `activities/examples/**` |
| 06 | Building a coding activity | `activities/coding/README.md`, `activities/examples/**` |
| 07 | Reusable fragments | `activities/tutors/README.md` (fragment sections), `activities/fragments/README.md`, module `README.md`s (fragment sections), `activities/examples/shared/**` |
| 08 | Hosting images | `docs/images.md` (behavior), `cli/README.md` (`images`), the image sections of module `README.md`s |

## 30: Sharing activities
_Turning an activity into a code and handing it to a class._

| # | Chapter | Where to look (hints) |
| --- | --- | --- |
| 01 | Creating a shared code | `docs/codes.md` (behavior), `cli/README.md` (`codes create`) |
| 02 | Viewing code usage | `docs/dashboard.md` (behavior), `docs/codes.md` |
| 03 | Time-limiting a code | `docs/codes.md` (window), `cli/README.md` (`--start`/`--end`) |
| 04 | Anonymous vs. per-user | `docs/codes.md` (anonymity), `docs/writing.md` (writing default) |
| 05 | Deleting a code | `docs/codes.md`, `docs/usage-metering.md` (behavior: deletion removes stats) |
| 06 | Special case: coding codes | `docs/coding.md` (behavior), `activities/coding/README.md` |
| 07 | Student reports | `docs/reports.md` (behavior), `docs/codes.md` (anonymity) |
| 08 | Many activities at once: the activity registry | `docs/registry.md` (format + sync semantics), `cli/README.md` (`codes sync`) |

## 40: Working with AI agents
_Using Novedu together with AI assistants and agents: the CLI skill, and the guide's machine-readable form. More AI topics land here over time._

| # | Chapter | Where to look (hints) |
| --- | --- | --- |
| 01 | The CLI and its AI skill | `cli/README.md` (intro), `.agents/skills/novedu-tutor-cli/SKILL.md`, `https://github.com/vercel-labs/skills#readme` |
| 02 | The guide for AI agents (llms.txt) | `docs/teacher-docs.md` (the llms.txt surface), `teacher-docs-site/README.md`, `https://llmstxt.org` |

> Scope reminder for every chapter: the "Where to look" entries are engineer
> references. Document only teacher-facing behavior, not how the app works inside
> (see the skill's `references/scope.md`). Per-chapter guardrails — each chapter's
> reader and the facts that are easy to get wrong — live in
> `docs/teacher-docs-notes.md`; read the chapter's entry before editing it.
