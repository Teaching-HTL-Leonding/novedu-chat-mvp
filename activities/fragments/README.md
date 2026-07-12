# Fragment libraries

A **fragment library** is a reusable, parameterized collection of prompt pieces — a
persona, a safety policy, a set of ground rules — written once and pulled into any
activity (tutor, quiz, writing, coding) via a top-level `fragment_files:` /
`fragments:` block. Fragments are a **cross-cutting** capability, not an activity
module of their own.

This folder holds only the **editor schema** for fragment-library files. The fragment
format itself — `input_schema`, `variables`, `priority`, assembly order — is fully
documented once in the tutor guide, [`../tutors/README.md`](../tutors/README.md).
Reusable libraries live under [`../examples/shared/`](../examples/shared/) — e.g.
[`../examples/shared/general-fragments.yaml`](../examples/shared/general-fragments.yaml).

## Editor support

This folder includes a JSON Schema for fragment-library YAML files:
`fragment-yaml.schema.json`. It is **generated from the zod schema** in
`lib/prompt-fragments/schemas.ts` via `npm run generate:schemas` — do not edit it by
hand.

Editors that use the YAML Language Server, including VS Code with YAML support, can
pick up the schema from a modeline comment at the top of a fragment-library file:

```yaml
# yaml-language-server: $schema=https://raw.githubusercontent.com/Teaching-HTL-Leonding/novedu-chat-mvp/refs/heads/main/activities/fragments/fragment-yaml.schema.json
```

This is a **separate** schema from the tutor schema — a fragment library is not a
tutor. Point tutor files at `../tutors/tutor-yaml.schema.json` and fragment-library
files at this one.

In VS Code, install the Red Hat YAML extension to get this schema support:
<https://marketplace.visualstudio.com/items?itemName=redhat.vscode-yaml>.

The line is a comment, not a YAML field. The app ignores it, but the editor can use
it for validation, completion, and hover help.
