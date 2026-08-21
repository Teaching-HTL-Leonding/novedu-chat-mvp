# Creating a shared code

Output: teacher-docs/content/30-sharing-activities/01-creating-codes.md · order 1

Job: A teacher turning an activity into a code to hand to a class. After this chapter
they can create a code from an activity, set the note, window, and model override, and
get the short link.

Cover:
- The steps: open the create-code form, point it at the activity (its URL or an
  uploaded file), add a note for yourself, optionally set an availability window and a
  model override, then submit and get a short link.
- The model override section: a provider and a model field, a reasoning select
  ("Provider default" plus every thinking-effort level the app offers), and one-click
  presets that fill the whole override at once, where a preset for a reasoning model
  fills the level too. Do not hard-code how many levels there are; read the current
  list from the source. Note that not every model accepts every level and that some
  models ignore the difference, and send the teacher to "Available AI models" for it.
- What you get: a short random link to hand to the class.
- What you set now versus later: the note, window, and override can be changed later;
  the activity file, the kind, and the anonymity setting are fixed when the code is
  created.
- Finding a code again: the Codes list holds every teacher's codes. Filter by
  note/code, by activity, or by **owner** — the dropdown starts on your own codes,
  "All owners" widens it to the whole school, and "Clear" brings you back to yours.
  An Owner column names the teacher on every row, and the column headers sort.

Get right:
- A code's owner is the teacher who created it, and it never changes hands — even
  though anyone may edit or delete any code.
- You do not choose the code text; it is generated.
- Anonymity comes from the activity and is frozen at creation; link to
  "Anonymous vs. per-user".
- The model override's provider and model are both-or-nothing, and a reasoning level
  only works alongside them; the override replaces the activity's whole `llm:` block,
  so leaving the reasoning on "Provider default" also drops the level the activity
  file sets. Link to "Available AI models".
- Pointing a code at an Azure model is a spending decision: SCCH, the school's Austrian
  LLM hosting partner, carries no usage-based cost, Azure models are paid per use, and a high
  thinking effort multiplies what a lesson costs there. Say it in one or two sentences
  and leave the detail to "Available AI models". No prices or rates, there are none in
  the sources.
- Coding codes are shared differently; link to "Special case: coding codes".
- Check the current source for whether codes are created in the app, the CLI, or both,
  and describe only what exists; do not assume a CLI create command.

Look: docs/codes.md (behaviour: the create and edit forms), cli/README.md (codes,
if present), README.md.
