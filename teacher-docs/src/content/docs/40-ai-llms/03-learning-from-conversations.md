---
title: Learning from real conversations
description: Export what students talked about under a code, let an AI assistant find patterns, and turn the findings into a better activity.
sidebar:
  order: 3
audience: teacher
keywords: [improve activity, analyse conversations, misconceptions, export, AI assistant, ChatGPT, Claude, codes export, feedback loop, data protection]
related:
  - 30-sharing-activities/10-exporting-conversations
  - 40-ai-llms/01-novedu-cli
  - 10-yaml-for-teachers/04-cli-validation
  - 10-yaml-for-teachers/06-testing-the-grader
  - 10-yaml-for-teachers/07-testing-a-tutor
  - 30-sharing-activities/07-student-reports
---

After a lesson, the conversations under a code show you what your students actually asked, where they got stuck, and how the AI answered. Reading 40 conversations yourself takes an evening. An AI assistant can read them in a minute and point you to the patterns, so you can spend your time on improving the activity.

The process has four steps: export the conversations, ask an assistant about them, change the activity, and check the change before the next class.

## Step 1: export the conversations

Export the conversations of a code you created with the Novedu CLI:

```bash
npx @novedu/cli@latest codes export k7f3qz --out k7f3qz.jsonl
```

The file holds every conversation under the code, without student names and without photos, though what students typed is included as they wrote it. Exporting a code's conversations has its own chapter with the details.

## Step 2: ask an AI assistant

Give the file to an AI assistant that can read uploaded files, for example ChatGPT or Claude, together with the activity's YAML file so it knows what the activity was meant to do. Then ask specific questions. Questions like these tend to work well:

- "Which misconceptions come up again and again in these conversations? Quote two or three examples for each."
- "Where did the tutor give away the answer, or drift away from the instructions in the YAML file?"
- "Which questions did students ask that the activity doesn't prepare the tutor for?"
- "Where did students give up or stop answering? What happened just before?"
- "Suggest concrete changes to the YAML file that would address the three biggest problems."

The assistant's answers are suggestions, not facts. Ask for quotes, and open a few of the conversations it points to before you change anything.

If you use an AI coding assistant together with the Novedu CLI skill, the assistant can run the whole loop itself: export the code, read the file, propose changes to the YAML file, and check them with the CLI. The chapter on the Novedu CLI and its AI skill shows how to install the skill.

## Step 3: change the activity

Turn the findings into changes in the activity's YAML file. Typical changes are a clearer instruction for the tutor, an extra hint for a common mistake, a sharper grading rule in a quiz, or a new question that covers a gap.

## Step 4: check the change before the next class

Check the changed file with the CLI before it reaches students. `validate` finds mistakes in the file. When you changed how a quiz grades or how a tutor should behave, run an eval as well: it shows how the AI reacts to the new version before a class does. Then publish the new version the way you host the file, for example with `files upload` for a file stored in the app.

Export the code again after the next lesson, and you can see whether the change helped.

## Data protection

The export holds no student names, but it holds what students wrote. Students sometimes type personal details into a chat, such as their name, their class, or something private. Treat the file like any other class material: follow your school's rules on which AI services may see student work, prefer a service your school has approved, and delete the file when you no longer need it.
