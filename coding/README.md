# Coding Activity Files

This folder contains **coding activity definitions** — the YAML files that describe
an **OpenAI-compatible coding endpoint**. A student points an external coding agent
(such as [little-coder](https://github.com/itayinbarr/little-coder)) at the app, and
codes against the school's model with behaviour you control. This guide explains the
format so that teachers can write their own activities without touching any code.

If you can edit a structured text file and follow the example below, you can build a
coding activity.

---

## 1. The idea in one minute

You write a short YAML that says **which model** to use and **how the assistant
should behave** (its system prompt). The app turns that into a time-limited **code**.
A student configures a coding agent with three things — **base URL**, **key**,
**model** — and starts coding. The **code is the API key**.

```
coding agent (little-coder)        the app                        SCCH model
  ─── request + your key ──▶  check code + window                 (e.g. gemma)
                              append your system prompt    ──▶
                              pin the model
  ◀────────── answer streamed straight back ──────────────────────
  runs its own tools (edit files, run code) on the student's machine
```

Unlike the tutor, quiz, and writing activities, there is **no in-app chat** — the
student works in their own terminal/editor through the coding agent. The endpoint is
a thin, gatekept relay: it adds your instructions and forwards to the model. Coding
activities are **always anonymous** — the requests carry no student identity, so
nothing is tracked or stored per student.

---

## 2. Quick start — a complete example

A minimal coding activity, `my-coding.yaml`:

```yaml
id: my-coding
name: "Beginner TypeScript Coding Buddy"
title: "TypeScript Coding Buddy (Beginners)"
llm:
  model: RedHatAI/gemma-4-31B-it-FP8-Dynamic
instructions: |
  You are a friendly TypeScript coding buddy for a BEGINNER. Keep every explanation
  and every line of code within what the student has learned:
  - only the primitive types number, string, boolean (arrays are fine); no classes
    or interfaces (no OOP)
  - only if / else if / else and basic while / for loops; no map/filter/reduce
    one-liners
  - no arrow functions — declare functions with the `function` keyword
  - always add explicit type annotations to every variable, parameter and return;
    never use `any`
  Teach in small steps and explain WHY.
```

This repository ships a complete example you can copy from:
[`beginner-typescript.yaml`](./beginner-typescript.yaml).

---

## 3. Coding file reference

A coding file has these fields. All are required unless marked optional.

```yaml
id: my-coding # short machine name
name: "My Coding Buddy" # optional: human-readable label
title: "Coding Buddy" # optional: label shown to the student on the /<code> page
llm:
  model: RedHatAI/gemma-4-31B-it-FP8-Dynamic # which model answers (server-only)
instructions: | # the assistant's system prompt (server-only)
  ...
```

### `id`

Required. A short machine-readable identifier for the activity.

### `name` and `title`

Both optional. `name` is a human-readable label; `title` is shown to the student on
the connection page (`/<code>`). Neither is required for the endpoint to work.

### `llm.model`

Required. The model that answers, on the SCCH server. Same id space as a tutor's,
quiz's, or writing's `llm.model`. **SERVER-ONLY** and **pinned**: the proxy always
uses this model and **ignores** whatever model the coding agent sends, so the student
never needs to know it.

### `instructions`

Required. The assistant's **system prompt**. **SERVER-ONLY** — never sent to the
browser or the coding agent — and **appended after** the coding tool's own prompt
(so your rules are the final word). This is where you constrain the assistant to what
your class has learned (a
language, a subset of features, a teaching style). See
[`beginner-typescript.yaml`](./beginner-typescript.yaml) for a thorough example.

> There is **no** `anonymous` field — coding activities are always anonymous — and
> **no** `placeholder` field (that one is for the writing editor).

---

## 4. Hosting your activity

The server fetches your activity over the internet, so it must be at a **public
`http(s)` URL**.

The easiest option is to **host it in the app itself** — no GitHub needed. On the
**YAML Files** page (`/files`) create a file of kind **Coding**; it is served at
`https://<origin>/api/files/<name>` and drops straight into a code.

Alternatively, put the `.yaml` in a public GitHub repo and use its **raw** URL
(commit and push first — the server reads the published version, not your local
copy).

---

## 5. Creating the code

Mint a code like any other activity — there is nothing coding-specific in the form:

1. Go to **Codes → New**.
2. **Activity:** choose **Coding**.
3. **File URL:** the URL of the coding YAML from step 4.
4. **Available from / until:** set a window, or leave **both blank** for an
   open-ended code (no start = active immediately; no end = never expires).
5. **Create code.**

You get a short code (e.g. `z1yxblebm2`). **That code is the API key.** Share the
code, or the `/<code>` link — which shows the student the exact connection settings
(base URL, key, and a ready-to-paste `models.json`).

---

## 6. Using the code with little-coder

[little-coder](https://github.com/itayinbarr/little-coder) is a coding agent built on
`pi`. It is config-driven, so you point it at the endpoint with a small JSON file.

**Install:**

```bash
npm install -g little-coder
```

**Configure** `~/.config/little-coder/models.json` (the `/<code>` page gives you a
ready-to-paste version — just copy it):

```json
{
  "providers": {
    "novedu": {
      "api": "openai-completions",
      "baseUrl": "https://<origin>/api/coding/v1",
      "apiKey": "<your-code>",
      "models": [
        {
          "id": "coding",
          "name": "Novedu coding",
          "reasoning": false,
          "input": ["text"],
          "contextWindow": 32768,
          "maxTokens": 4096,
          "cost": { "input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0 }
        }
      ]
    }
  }
}
```

- **`baseUrl`** is `https://<origin>/api/coding/v1` (the app's host + `/api/coding/v1`).
- **`apiKey`** is the **code**.
- The **`id`** (`coding` here) is arbitrary — the app always uses the model the
  teacher pinned, so put any name you like.

**Run** — one-shot with `-p`, or interactively:

```bash
# one-shot
little-coder --model novedu/coding -p "Write a function that returns the first n even numbers."

# interactive
little-coder --model novedu/coding
```

little-coder answers — and, when you let it, edits files and runs code **on the
student's machine** — all within the limits your `instructions` set. Add `-nt` to
disable tools for a plain chat-only request (a quick way to confirm the connection
works).

> Other OpenAI-compatible Chat Completions clients work too: point them at the same
> base URL and use the code as the API key. (Clients that probe `GET /v1/models` on
> startup are not supported yet — little-coder does not need it.)

---

## 7. Validating your activity

Structural validation for coding files is **not implemented yet** — a coding file is
**not** schema-checked when you save or create a code (unlike tutor, quiz, and
writing files, which are strictly validated). Take care to get the structure right
yourself: the endpoint needs a non-empty **`instructions`** and an **`llm.model`**,
or it returns an error to the coding agent at runtime instead of failing early.

---

## 8. Checklist before you publish

- [ ] The activity has an `id`, an `llm.model` (a real SCCH model id), and a
      non-empty `instructions`.
- [ ] `instructions` constrains the assistant to what your class has learned
      (language, feature subset, teaching style).
- [ ] The file is **public** and, if on GitHub, **pushed**.
- [ ] You created a **Coding** code pointing at the file, with the window you want
      (blank = open-ended).
- [ ] You handed students the code (or the `/<code>` link) so they can configure
      little-coder.
