# See the exact prompt

Output: teacher-docs/content/10-yaml-for-teachers/05-see-the-prompt.md · order 5

Job: A teacher who wants to know what the AI is actually told, not just whether the
file is valid. After this chapter they can dump the prompts of any activity kind, read
the summary, get the full text as JSON, and know the three situations the command
earns its keep in.

Cover:
- What the command does: it prints the finished prompt an activity produces, with every
  fragment and text-file marker already replaced by the text it stands for. Validation
  answers "is my file well-formed"; this answers "what does the AI actually read".
- The command itself, with a file path or a URL, and the --kind option (tutor is the
  default; quiz, writing, and coding are the others). There is no fragment kind: a
  fragment library has no prompt of its own, its fragments show up inside the activity
  that places them. Quote the real commands and the real summary output.
- Summary versus --json: the summary lists each prompt with its size, --json carries
  the full text (and can be filtered with a JSON tool for one question's prompt).
- What each kind gives: tutor and writing give the one system prompt; a quiz gives one
  grading prompt per question plus the discussion prompt; a coding activity also gives
  the system message the server sends on to the student's coding agent.
- Why a teacher would want this. Three reasons, each in the teacher's terms:
  1. Debugging. When a tutor ignores one of your rules or a quiz grades in a way you
     did not expect, the finished prompt shows whether your text really arrived: a
     fragment that was never placed, a marker sitting in a section you thought you had
     removed, a variable that filled in with something other than what you meant.
     Reading the prompt usually explains the behaviour faster than changing the file
     and trying again. Note the boundary: a fragment that cannot render at all makes
     the command report an error instead of a prompt, and validate is the tool that
     names that kind of problem field by field.
  2. Reusing the prompt somewhere else. The output is ordinary text, so a teacher can
     paste it into another AI tool (ChatGPT and friends) to try the same instructions
     outside Novedu, pass them to a colleague, or keep them with the lesson material.
  3. Evaluation runs. Explain what evaluation means for a teacher who is not deep into
     AI: checking an activity systematically instead of by feel, by taking a set of
     sample student answers, running them all through the same prompt, and looking at
     whether the results are what you want. Useful before a class meets the activity,
     and for comparing the results before and after you change your instructions.
     Then say that Novedu does this natively: the eval command (the next chapter,
     "Testing how a quiz grades") replays a file of sample answers through the real
     grader and reports the differences — prompts is how you READ what the grader is
     told, eval is how you MEASURE what it does. Do not describe any manual
     run-the-answers-by-hand workflow; forward-link to the next chapter instead.
- Why this is a command rather than a screen in the app: it is meant to be used by an
  AI assistant at least as much as by a person, the assistant runs it and explains the
  answer, and it needs no sign-in and uploads nothing. A screen in the app can follow
  later if teachers ask for one. Keep this short and matter-of-fact, one short section.
- The bundled AI skill: the same skill that helps with validation also drives this
  command, so a teacher can ask "show me the grading prompt for question 3" instead of
  typing flags. Don't explain what the skill is or how to install it, that's the
  introduction chapter "The Novedu CLI and its AI skill"; point at it instead.

Get right:
- prompts and validate are complementary, never alternatives. Do not present prompts as
  a validity check. It runs the same loading path the app runs when a student opens the
  activity, which is why the output is what the model really gets.
- --kind is caller-declared, exactly like validate's, minus fragment.
- A local path and a public URL both work. A URL reads the published file, so commit
  and push first.
- The dump reports the activity file's own AI model, and its reasoning level when the
  file sets one. What a code overrides when sharing is not applied, because a dump
  describes a file.
- A quiz's grading prompts contain the teacher-only evaluation criteria and are never
  shown to students. Say plainly that the output is teacher material, like the file.
- No version history and no "this arrived later than that". The app is under heavy
  development, so a version floor is stale within weeks. Describe how the command
  behaves now and leave release history out of the chapter entirely.
- Use verbatim commands and real output, not invented ones.

Look: cli/README.md (the prompts section), the "See the exact prompt" section in each
module README under activities/, .agents/skills/novedu-tutor-cli/SKILL.md.
