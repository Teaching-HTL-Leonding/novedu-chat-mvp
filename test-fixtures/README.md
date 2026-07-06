# Test fixtures

Frozen, **synthetic** activity YAML authored purely for the automated tests —
**not** demos. They are intentionally minimal and built from explicit `MARKER`
strings so it is obvious they are test scaffolding. Keep them **content-stable**:
tests assert on their exact ids, markers, and error shapes.

Nothing here depends on the repo's [`activities/`](../activities) folder (which
holds real demo content, free to restructure). These files exist because two
layers genuinely need a real file/URL:

- **CLI** — `@novedu/cli validate <path>` reads a file, so the CLI tests point at
  `test-fixtures/activities/…`.
- **e2e** — the app fetches an activity YAML by URL server-side; `serve.mjs`
  serves this tree over HTTP as a second Playwright `webServer` (see
  `playwright.config.ts`), so specs run fully offline.

The `lib/tutors` unit tests need no files at all — their synthetic tutor/fragment
fixtures live in-code in `lib/tutors/test-fixtures.ts`.

## Models

Hermetic fixtures use a fake `model: test-model` (nothing calls an LLM). The three
`@live-llm` fixtures — `tutors/live-tutor.yaml`, `tutors/vision-tutor.yaml`, and
`writings/test-writing.yaml` — carry a **real** model id because those specs drive
the live SCCH endpoint.

## Layout

```
activities/
  tutors/    test-tutor.yaml (→ test-fragments-a.yaml), test-fragments-a.yaml,
             broken-tutor.yaml (→ broken-fragments.yaml), broken-fragments.yaml,
             broken-template-fragments.yaml,
             live-tutor.yaml [@live-llm], vision-tutor.yaml [@live-llm]
  quizzes/   test-quiz.yaml, broken-quiz.yaml
  writings/  test-writing.yaml [@live-llm], broken-writing.yaml
  coding/    test-coding.yaml, broken-coding.yaml
```
