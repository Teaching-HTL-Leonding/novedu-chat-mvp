# Activities

Authored activity YAML for the chat app, grouped by module. Each subfolder holds
sample and fixture files plus a hand-maintained JSON-Schema mirror (referenced by
a `# yaml-language-server:` modeline for editor IntelliSense) and its own authoring
guide:

| Folder | Module | Guide |
| --- | --- | --- |
| [`tutors/`](tutors/README.md) | AI tutor + fragment libraries | [tutors/README.md](tutors/README.md) |
| [`quizzes/`](quizzes/README.md) | LLM-graded open-ended quiz | [quizzes/README.md](quizzes/README.md) |
| [`writings/`](writings/README.md) | Markdown writing activity | [writings/README.md](writings/README.md) |
| [`coding/`](coding/README.md) | OpenAI-compatible coding endpoint | [coding/README.md](coding/README.md) |

Validate any file with the `@novedu/cli` (see [`cli/README.md`](../cli/README.md)):

```bash
npx @novedu/cli validate ./activities/tutors/simple-tutor.yaml
npx @novedu/cli validate ./activities/quizzes/sample-quiz.yaml --kind quiz
npx @novedu/cli validate ./activities/writings/human-animal-short-story.yaml --kind writing
npx @novedu/cli validate ./activities/coding/beginner-typescript.yaml --kind coding
```

These files are content only — they are not bundled into the runtime image.
