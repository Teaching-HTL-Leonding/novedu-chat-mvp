# Writing Tutor Files

This folder contains **tutor definitions** and **fragment libraries** — the YAML
files that describe how an AI tutor should behave. This guide explains the format
so that teachers can write their own tutors without touching any code.

You do not need to be a programmer. If you can edit a structured text file and
follow the examples below, you can build a tutor.

---

## 1. The idea in one minute

An AI tutor is driven by a **system prompt** — a block of instructions that tells
the model who it is, what subject it teaches, how to behave, and what it must not
do.

Instead of writing one long prompt by hand, you assemble it from small, reusable
**fragments**. Each fragment is a self-contained piece of guidance (a persona, a
set of rules, a safety policy, a topic description …). A **tutor file** picks the
fragments it wants, fills in their blanks, and the system builds the final prompt
for you.

```
fragment library (reusable pieces)        tutor file (your selection)
┌───────────────────────────┐             ┌─────────────────────────────┐
│ persona                   │  ◀────────  │ use "persona"               │
│ ground_rules              │  ◀────────  │   subject = "basic arithmetic"
│ safety                    │             │ use "ground_rules"          │
│ …                         │             │   rules = […]               │
└───────────────────────────┘             └─────────────────────────────┘
                       │                                 │
                       └──────────────┬──────────────────┘
                                      ▼
                          assembled system prompt
```

This means policies like a Socratic teaching style or a child-safety rule are
written **once** in a fragment library and reused by many tutors.

---

## 2. The two kinds of files

| File                 | What it is                                                         | Who writes it                        |
| -------------------- | ------------------------------------------------------------------ | ------------------------------------ |
| **Fragment library** | A collection of reusable prompt pieces (fragments).                | Usually shared/maintained centrally. |
| **Tutor file**       | Selects fragments, supplies their values, adds final instructions. | You, per subject.                    |

Both are plain YAML. A fragment library is referenced by a tutor file through a
public URL (see [Hosting](#8-hosting-your-files)).

---

## 3. Quick start — a complete minimal example

A tiny fragment library, `simple-fragments.yaml`:

```yaml
id: simple-fragments
fragments:
  - id: persona
    version: 1
    priority: 100
    input_schema:
      type: object
      required:
        - subject
      properties:
        subject:
          type: string
        greeting: # optional — a default is used when the tutor omits it
          type: string
          default: "Hi there!"
    content: |
      {{greeting}}

      You are a friendly, encouraging tutor for {{subject}}.

      Explain ideas simply and check the student's understanding with short questions.

  - id: ground_rules
    version: 1
    priority: 200
    input_schema:
      type: object
      required:
        - rules
      properties:
        rules:
          type: array
          items:
            type: string
    content: |
      Follow these ground rules:
      {{#each rules}}
      - {{this}}
      {{/each}}
```

A tutor file, `simple-tutor.yaml`, that uses it:

```yaml
id: simple-math-tutor
name: "Simple Math Tutor"
description: "A minimal, valid example tutor."
llm:
  model: RedHatAI/gemma-4-31B-it-FP8-Dynamic
prompt:
  fragment_files:
    - id: simple_fragments
      url: "simple-fragments.yaml" # relative — sits next to this tutor file

  fragments:
    - file: simple_fragments
      id: persona
      variables:
        subject: "basic arithmetic"
        # `greeting` is omitted on purpose, so its default ("Hi there!") is used.

    - file: simple_fragments
      id: ground_rules
      variables:
        rules:
          - "Never give the final answer immediately."
          - "Encourage the student to try each step themselves."
          - "Keep explanations short and friendly."

  tutor_instructions: |
    Always stay positive and patient. If the student is stuck, give a small hint
    rather than the full solution.
```

The assembled system prompt becomes:

```text
Hi there!

You are a friendly, encouraging tutor for basic arithmetic.

Explain ideas simply and check the student's understanding with short questions.

Follow these ground rules:
- Never give the final answer immediately.
- Encourage the student to try each step themselves.
- Keep explanations short and friendly.

Always stay positive and patient. If the student is stuck, give a small hint
rather than the full solution.
```

These two files are kept in this folder (`simple-fragments.yaml`,
`simple-tutor.yaml`) as a stable, working reference.

---

## 4. Tutor file reference

A tutor file has these fields. All of them are required unless marked optional.

```yaml
id: my-tutor # short machine name, e.g. "fractions-de"
name: "My Tutor" # human-readable title
description: "What this tutor does."
llm:
  model: RedHatAI/gemma-4-31B-it-FP8-Dynamic # which model serves this tutor
prompt:
  fragment_files: [...] # the libraries you pull fragments from
  fragments: [...] # the fragments you include, in order
  tutor_instructions: | # your own final instructions (free text)
    ...
```

### `prompt.fragment_files`

Declares which fragment libraries this tutor uses and gives each one a short
local **alias** you refer to later.

```yaml
fragment_files:
  - id: simple_fragments # the alias (you choose this)
    url: "simple-fragments.yaml" # the library file (relative to this tutor)
```

- `id` — the alias used by your fragment entries. Pick something readable.
- `url` — where the library file lives. Two forms are allowed:
  - **Absolute** — a full `http(s)://…` link (e.g. a "raw" GitHub URL). Use this
    when the library lives somewhere else than your tutor file.
  - **Relative** — just a path, like `simple-fragments.yaml` or
    `../shared/general-fragments.yaml`. It is resolved **next to your tutor file**:
    the system takes your tutor's own URL, drops its filename, and appends the path.
    So if your tutor is published at
    `https://.../tutors/my-tutor.yaml`, then `simple-fragments.yaml` is loaded from
    `https://.../tutors/simple-fragments.yaml`. This is the easiest option when the
    tutor and its libraries sit in the same folder (as the examples here do).

  Either way the file must be reachable by the server (see
  [Hosting](#8-hosting-your-files)). Only `http(s)` is allowed — an absolute URL
  with any other scheme (e.g. `ftp:`) is rejected.

### `prompt.fragments`

The ordered list of fragments to include. Each entry says **which** fragment and
supplies its **values**.

```yaml
fragments:
  - file: simple_fragments # must match an alias from fragment_files
    id: persona # the fragment's id inside that library
    variables: # values for the fragment's inputs
      subject: "basic arithmetic"
```

- `file` — the alias of the library (from `fragment_files`).
- `id` — the fragment's `id` within that library.
- `variables` — _(optional)_ the values the fragment needs (see
  [Inputs and variables](#6-inputs-and-variables)).
- `required` — _(optional)_ a flag you can set to `true` to mark a fragment as
  important to keep. It is accepted but does not change validation today.

> The order you list fragments in does **not** decide the final order — `priority`
> does (see [How the prompt is assembled](#7-how-the-prompt-is-assembled)). It is
> good practice to list them in priority order anyway, for readability.

### `prompt.tutor_instructions`

Free-form text appended **after** all fragments. This is where you put the
concrete, tutor-specific framing in your own words.

---

## 5. Fragment library reference

A fragment library has an `id` and a list of `fragments`:

```yaml
id: simple-fragments
fragments:
  - id: persona # unique within this library
    version: 1 # a number you bump when you change it
    priority: 100 # decides assembly order (lower = earlier)
    input_schema: { ... } # optional: the inputs this fragment expects
    classification: { ... } # optional: metadata, e.g. for safety pieces
    content: | # the prompt text (a Handlebars template)
      ...
```

Field by field:

- `id` — unique name within the library; this is what a tutor refers to.
- `version` — a number; increase it when you change the fragment meaningfully.
- `priority` — a number controlling order in the final prompt. **Lower numbers
  come first.** Keep priorities unique across all fragments a tutor uses.
- `input_schema` — _(optional)_ declares the variables the fragment needs. Omit
  it for fragments that take no inputs.
- `classification` — _(optional)_ metadata. For example a safety fragment may use
  `type: safety` with `override_allowed: false`.
- `content` — the actual text, written as a [Handlebars template](#writing-content).

---

## 6. Inputs and variables

A fragment declares what it needs with `input_schema`, and a tutor supplies those
values with `variables`. They must agree.

### Declaring inputs (`input_schema`)

```yaml
input_schema:
  type: object
  required:
    - subject # these inputs MUST be supplied
    - rules
  properties:
    subject:
      type: string # a single line of text
    rules:
      type: array # a list…
      items:
        type: string # …of text items
```

The supported value types are:

| `type`                | Meaning              | Example value           |
| --------------------- | -------------------- | ----------------------- |
| `string`              | A piece of text      | `subject: "fractions"`  |
| `boolean`             | `true` or `false`    | `allow_solution: false` |
| `array` (of `string`) | A list of text items | `rules: ["…", "…"]`     |

### Optional inputs with a `default`

An input that is **not** in `required` is optional. If its `content` references it, the
tutor must still supply it — unless the property declares a `default`, which is used
whenever the tutor omits the value:

```yaml
input_schema:
  type: object
  required:
    - subject # must be supplied
  properties:
    subject:
      type: string
    greeting:
      type: string
      default: "Hello!" # optional — used when the tutor doesn't set `greeting`
    allow_solution:
      type: boolean
      default: false # lets `{{#unless allow_solution}}` work without supplying it
```

- A `default` must match its property's `type` (a text default on a `boolean` property
  is rejected).
- A supplied `variables` value always wins over the default.
- Putting a `default` on a `required` input is pointless — the value must be supplied
  anyway, so the default can never apply. The validator flags this with a warning.

### Supplying values (`variables`)

```yaml
variables:
  subject: "basic arithmetic"
  rules:
    - "Never give the final answer immediately."
    - "Keep explanations short and friendly."
```

Rules the validator enforces:

- Every input listed under `required` must be present in `variables`.
- Each value's type must match what `input_schema` declares.
- Supplying a value the fragment doesn't declare is allowed but produces a
  **warning** (it usually means a typo).

> **Note:** Only literal `variables` are supported. An older `bind:` mechanism
> (for runtime references) is accepted but **ignored** — always provide concrete
> values via `variables`.

---

## Writing content

A fragment's `content` is a [Handlebars](https://handlebarsjs.com/) template. You
only need three constructs:

**1. Insert a value** with `{{name}}`:

```yaml
content: |
  You are a tutor for {{subject}}.
```

**2. Loop over a list** with `{{#each}}` … `{{/each}}`, using `{{this}}` for the
current item:

```yaml
content: |
  Follow these ground rules:
  {{#each rules}}
  - {{this}}
  {{/each}}
```

**3. Show text only when a flag is off** with `{{#unless}}`:

```yaml
content: |
  {{#unless allow_solution}}
  Do not give away the full solution.
  {{/unless}}
```

Notes:

- Text is inserted **verbatim** — special characters like `<`, `>` and `&` are
  preserved, so ASCII diagrams (e.g. `[A] -> [B]`) survive unchanged.
- If a template uses `{{something}}` that you never declared or supplied, the
  build fails — declare every variable you reference.

---

## 7. How the prompt is assembled

1. Each included fragment's `content` is rendered with its supplied `variables`.
2. Rendered fragments are ordered by **`priority`, ascending** (lowest first).
3. `tutor_instructions` is appended **last**.
4. The pieces are joined with blank lines into the final system prompt.

Because order is driven by `priority`, two fragments a tutor uses must not share
the same priority — otherwise the order would be ambiguous and validation fails.

---

## 8. Hosting your files

The server fetches your files over the internet, so they must be at a **public
`http(s)` URL**.

The easiest option is GitHub:

1. Put your `.yaml` files in a public repository.
2. Use the **raw** URL of each file, for example:
   `https://raw.githubusercontent.com/<org>/<repo>/refs/heads/main/tutors/your-fragments.yaml`
3. Reference each library from your tutor's `fragment_files[].url`. If the library sits
   **in the same folder** as the tutor file (as the examples in this repo do), you can
   use just the filename — e.g. `your-fragments.yaml` — and it is resolved next to the
   tutor's own URL. Use a full raw URL when the library lives somewhere else.

Remember to **commit and push** changes before validating — the server reads the
published version, not your local copy. (A relative reference is resolved against the
tutor's published URL, so the library must be pushed too.)

---

## 9. Validating your tutor

Open the **Validate Tutor** page in the app, paste your tutor file's public URL,
and click **Validate**. You'll get either:

- the **assembled system prompt** (as markdown source), or
- a **list of problems** to fix.

The validator checks, in order:

1. The file is valid YAML.
2. The tutor file has the correct structure (no missing or misspelled fields).
3. Every referenced fragment library loads and has the correct structure.
4. Every fragment reference resolves and every required input is supplied with the
   right type.
5. The prompt assembles cleanly.

### Common problems and how to fix them

| Reported problem                                    | What it means                                                  | How to fix                                       |
| --------------------------------------------------- | -------------------------------------------------------------- | ------------------------------------------------ |
| `YAML_PARSE_ERROR`                                  | The file isn't valid YAML.                                     | Check indentation and quotes.                    |
| `TUTOR_SCHEMA_ERROR` / `FRAGMENT_FILE_SCHEMA_ERROR` | A field is missing, has the wrong type, or is misspelled.      | Compare against this guide; fix the named field. |
| `FETCH_FAILED`                                      | A URL couldn't be loaded.                                      | Check the URL is public and pushed.              |
| `UNKNOWN_FRAGMENT_FILE_ALIAS`                       | A fragment's `file:` doesn't match any `fragment_files` alias. | Use the exact alias you declared.                |
| `FRAGMENT_NOT_FOUND`                                | The `id:` isn't in that library.                               | Check the fragment's spelling/existence.         |
| `MISSING_REQUIRED_VARIABLE`                         | A required input wasn't supplied.                              | Add it under `variables`.                        |
| `VARIABLE_TYPE_MISMATCH`                            | A value's type is wrong (e.g. text where a list is expected).  | Provide the declared type.                       |
| `DUPLICATE_PRIORITY`                                | Two included fragments share a priority.                       | Give each a distinct `priority`.                 |
| `UNDECLARED_VARIABLE` _(warning)_                   | You supplied a value the fragment doesn't use.                 | Usually a typo — remove or correct it.           |
| `REQUIRED_PROPERTY_HAS_DEFAULT` _(warning)_         | A `required` input also declares a `default` it can never use. | Drop the `default`, or remove it from `required`. |

---

## 10. Checklist before you publish

- [ ] Each fragment has a **unique** `id` within its library.
- [ ] Priorities are **unique** across the fragments a tutor uses.
- [ ] Every `required` input is supplied with the **correct type**.
- [ ] Every `{{variable}}` used in `content` is declared and either supplied or has a `default`.
- [ ] All `url`s are **public** and **pushed** (relative refs resolve against the tutor's URL).
- [ ] You validated the tutor and the prompt looks right.
