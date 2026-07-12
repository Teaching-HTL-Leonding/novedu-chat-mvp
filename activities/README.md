# Activities

Authoring documentation and sample activity YAML for the chat app, with a clear
separation between **schema/docs** (one folder per module) and **examples**
(one folder per topic).

Each module folder holds that module's authoring guide plus a JSON Schema
**generated from the zod schema** (via `npm run generate:schemas`; do not hand-edit)
and referenced by a `# yaml-language-server:` modeline for editor IntelliSense:

| Folder | Module | Guide |
| --- | --- | --- |
| [`tutors/`](tutors/README.md) | AI tutor + fragment libraries | [tutors/README.md](tutors/README.md) |
| [`quizzes/`](quizzes/README.md) | LLM-graded open-ended quiz | [quizzes/README.md](quizzes/README.md) |
| [`writings/`](writings/README.md) | Markdown writing activity | [writings/README.md](writings/README.md) |
| [`coding/`](coding/README.md) | OpenAI-compatible coding endpoint | [coding/README.md](coding/README.md) |
| [`fragments/`](fragments/README.md) | Reusable prompt-fragment libraries (cross-cutting) | [fragments/README.md](fragments/README.md) |

**Prompt fragments are a cross-cutting capability of all four kinds.** A fragment is a
reusable, parameterized prompt piece — a persona, a safety policy, a set of ground
rules — written once in a **fragment library** and pulled into an activity via a
top-level `fragment_files:`/`fragments:` block. Every kind assembles them the same
way: tutor, quiz, writing, and coding all prepend the assembled fragments ahead of
their own instructions (for a quiz, ahead of **both** the grader prompt and the
discussion chat). The fragment format, `input_schema`, `variables`, and `priority`
are fully documented once in the tutor guide, [`tutors/README.md`](tutors/README.md);
the other guides link back to it, and the fragment-library **editor schema** lives in
[`fragments/`](fragments/README.md). Fragment libraries reused across kinds live in
[`examples/shared/`](examples/shared/) — e.g.
[`examples/shared/general-fragments.yaml`](examples/shared/general-fragments.yaml).

Complete sample activities live under [`examples/`](examples/), grouped by
**topic**: each topic folder combines all the YAML belonging to one teaching
unit — across modules — so the files that are used together sit together:

| Folder | Topic |
| --- | --- |
| [`examples/sorting-algorithms/`](examples/sorting-algorithms/) | Bubble & Selection Sort in TypeScript + p5.js — tutor, quiz, and coding activity |
| [`examples/review-writing/`](examples/review-writing/) | Writing an English review/critique — tutor, quiz, and writing activity |
| [`examples/authoring/`](examples/authoring/) | Authoring coaches for teachers ("Tutor Tutor", "Quiz Tutor", …) + their fragment library |
| [`examples/shared/`](examples/shared/) | Fragment libraries reused across topics (referenced as `../shared/<name>.yaml`) |

Validate any file with the `@novedu/cli` (see [`cli/README.md`](../cli/README.md)):

```bash
npx @novedu/cli validate ./activities/examples/sorting-algorithms/sorting-tutor.yaml
npx @novedu/cli validate ./activities/examples/sorting-algorithms/sorting-quiz.yaml --kind quiz
npx @novedu/cli validate ./activities/examples/review-writing/restaurant-review-letter.yaml --kind writing
npx @novedu/cli validate ./activities/examples/sorting-algorithms/sorting-visualizer.yaml --kind coding
```

Every module's `llm:` block takes the same two fields: a required `model` and an
optional `provider` (`SCCH` when omitted — the school's self-hosted server;
`Azure Foundry` serves the activity from an Azure OpenAI deployment, with `model`
naming the deployment). See each guide's `llm.provider` section. Validating a
file that sets `llm.provider` requires `@novedu/cli` ≥ 0.6.0 — older releases
bundle strict schemas that reject the key.

The `llm:` block is the activity's **default**: when a teacher mints a code for
it, the code's create/edit form can **override provider + model per code**
(always both together, with one-click presets), so the same YAML file can be
handed out once on SCCH and once on Azure Foundry without duplicating it.

These files are content only — they are not bundled into the runtime image.
