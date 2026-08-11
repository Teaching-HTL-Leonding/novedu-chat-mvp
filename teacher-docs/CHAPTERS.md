# Chapters (information architecture)

The chapter list **is** the IA. Module-spine reference corpus for now; a
jobs-to-be-done `recipes/` track can come later, seeded from real teacher questions.

Each row: the prompt file (human-owned IP) and where it looks for ground truth. `✎` =
prompt drafted; `·` = planned (prompt not yet written). Reorder / rename freely, this
manifest is the place to decide structure before generating.

This manifest is also the **map for keeping docs current**: given a code change, an
agent reads the git diff and uses the "Where to look" column to judge which chapters
a change plausibly affects, then patches those. That reasoning replaces any
per-chapter source list in the docs themselves.

## 00: Introduction
_What Novedu is. Concepts and pedagogy, no deep configuration detail._

| # | Chapter | Prompt | Where to look (hints) |
| --- | --- | --- | --- |
| 01 | What is Novedu | ✎ `00-introduction/01-what-is-novedu.prompt.md` | `README.md`, `activities/README.md`, `activities/tutors/README.md` |
| 02 | What is a shareable code | ✎ `00-introduction/02-shareable-codes.prompt.md` | `docs/codes.md` (behavioral parts), `README.md` |
| 03 | Tutors overview | ✎ `00-introduction/03-tutors-overview.prompt.md` | `activities/tutors/README.md` |
| 04 | Quizzes overview | ✎ `00-introduction/04-quizzes-overview.prompt.md` | `activities/quizzes/README.md` |
| 05 | Writing overview | ✎ `00-introduction/05-writing-overview.prompt.md` | `activities/writings/README.md` |
| 06 | Coding overview | ✎ `00-introduction/06-coding-overview.prompt.md` | `activities/coding/README.md` |

## 10: YAML for teachers
_Enough YAML, tooling, and validation to author activities confidently._

| # | Chapter | Prompt | Where to look (hints) |
| --- | --- | --- | --- |
| 01 | The idea behind YAML | ✎ `10-yaml-for-teachers/01-why-yaml.prompt.md` | `activities/README.md`, module `README.md`s |
| 02 | YAML 101 | ✎ `10-yaml-for-teachers/02-yaml-101.prompt.md` | `activities/examples/**`, `activities/tutors/README.md` |
| 03 | JSON schemas in your editor | ✎ `10-yaml-for-teachers/03-json-schemas-vscode.prompt.md` | `activities/**/README.md` (modeline), the schema files, `https://github.com/redhat-developer/vscode-yaml` |
| 04 | Validating with the CLI | ✎ `10-yaml-for-teachers/04-cli-validation.prompt.md` | `cli/README.md`, `.agents/skills/novedu-tutor-cli/SKILL.md` |
| 05 | See the exact prompt | ✎ `10-yaml-for-teachers/05-see-the-prompt.prompt.md` | `cli/README.md` (`prompts`), the "See the exact prompt" section of each module `README.md` under `activities/`, `.agents/skills/novedu-tutor-cli/SKILL.md` |
| 06 | Testing how a quiz grades | ✎ `10-yaml-for-teachers/06-testing-the-grader.prompt.md` | `activities/evals/README.md`, the "Testing the grading itself" section of `activities/quizzes/README.md`, `cli/README.md` (`eval`), `docs/cli-eval.md` (behavior only), `.agents/skills/novedu-tutor-cli/SKILL.md` |

## 20: Building activities
_What makes each activity, field by field, the YAML reference backbone._

| # | Chapter | Prompt | Where to look (hints) |
| --- | --- | --- | --- |
| 01 | Publishing your YAML (GitHub or upload) | ✎ `20-building-activities/01-handling-yaml.prompt.md` | `docs/files.md` (behavior), `cli/README.md` (`files`), `activities/README.md` |
| 02 | Available AI models | ✎ `20-building-activities/02-available-llms.prompt.md` | `docs/ai-models.md` (teacher-visible parts), `activities/README.md` |
| 03 | Building a tutor | ✎ `20-building-activities/03-tutors.prompt.md` | `activities/tutors/README.md`, `activities/examples/**` |
| 04 | Building a quiz | ✎ `20-building-activities/04-quizzes.prompt.md` | `activities/quizzes/README.md`, `activities/examples/**` |
| 05 | Building a writing activity | ✎ `20-building-activities/05-writing.prompt.md` | `activities/writings/README.md`, `activities/examples/**` |
| 06 | Building a coding activity | ✎ `20-building-activities/06-coding.prompt.md` | `activities/coding/README.md`, `activities/examples/**` |
| 07 | Reusable fragments | ✎ `20-building-activities/07-fragments.prompt.md` | `activities/tutors/README.md` (fragment sections), `activities/fragments/README.md`, module `README.md`s (fragment sections), `activities/examples/shared/**` |
| 08 | Hosting images | ✎ `20-building-activities/08-hosted-images.prompt.md` | `docs/images.md` (behavior), `cli/README.md` (`images`), the image sections of module `README.md`s |

## 30: Sharing activities
_Turning an activity into a code and handing it to a class._

| # | Chapter | Prompt | Where to look (hints) |
| --- | --- | --- | --- |
| 01 | Creating a shared code | ✎ `30-sharing-activities/01-creating-codes.prompt.md` | `docs/codes.md` (behavior), `cli/README.md` (`codes create`) |
| 02 | Viewing code usage | ✎ `30-sharing-activities/02-viewing-usage.prompt.md` | `docs/dashboard.md` (behavior), `docs/codes.md` |
| 03 | Time-limiting a code | ✎ `30-sharing-activities/03-time-limitation.prompt.md` | `docs/codes.md` (window), `cli/README.md` (`--start`/`--end`) |
| 04 | Anonymous vs. per-user | ✎ `30-sharing-activities/04-anonymous-vs-per-user.prompt.md` | `docs/codes.md` (anonymity), `docs/writing.md` (writing default) |
| 05 | Deleting a code | ✎ `30-sharing-activities/05-deleting-codes.prompt.md` | `docs/codes.md`, `docs/usage-metering.md` (behavior: deletion removes stats) |
| 06 | Special case: coding codes | ✎ `30-sharing-activities/06-coding-special-case.prompt.md` | `docs/coding.md` (behavior), `activities/coding/README.md` |
| 07 | Student reports | ✎ `30-sharing-activities/07-student-reports.prompt.md` | `docs/reports.md` (behavior), `docs/codes.md` (anonymity) |
| 08 | Many activities at once: the activity registry | ✎ `30-sharing-activities/08-activity-registry.prompt.md` | `docs/registry.md` (format + sync semantics), `cli/README.md` (`codes sync`) |

## 40: Working with AI agents
_Using Novedu together with AI assistants and agents: the CLI skill, and the guide's machine-readable form. More AI topics land here over time._

| # | Chapter | Prompt | Where to look (hints) |
| --- | --- | --- | --- |
| 01 | The CLI and its AI skill | ✎ `40-ai-llms/01-novedu-cli.prompt.md` | `cli/README.md` (intro), `.agents/skills/novedu-tutor-cli/SKILL.md`, `https://github.com/vercel-labs/skills#readme` |
| 02 | The guide for AI agents (llms.txt) | ✎ `40-ai-llms/02-llms-txt.prompt.md` | `docs/teacher-docs.md` (the llms.txt surface), `teacher-docs-site/README.md`, `https://llmstxt.org` |

> Scope reminder for every chapter: the "Where to look" entries are engineer
> references. Document only teacher-facing behavior, not how the app works inside
> (see the skill's `references/scope.md`).
