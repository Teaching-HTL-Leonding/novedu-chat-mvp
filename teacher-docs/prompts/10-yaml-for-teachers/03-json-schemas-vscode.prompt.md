# JSON schemas in your editor

Output: teacher-docs/content/10-yaml-for-teachers/03-json-schemas-vscode.md · order 3

Job: A teacher who wants autocomplete and error-checking while writing an activity.
After this chapter they have installed the Red Hat YAML extension, added the schema
line to the top of a file, and know what help the editor then gives them.

Cover:
- What the editor gives you: suggestions as you type, red underlines for misspelled or
  wrong-typed fields, and descriptions on hover.
- The setup: install the Red Hat YAML extension in your editor, then add the schema
  modeline (the "# yaml-language-server: $schema=..." comment) at the top of the file;
  the editor loads the schema automatically.
- Which schema for which kind: there is a SEPARATE schema per kind — tutor, fragment
  library, quiz, writing, coding — plus one for the activity registry. Quote the real
  modeline from an example file.

Get right:
- The modeline is a specific comment on the first line; quote a real one from an
  example activity rather than paraphrasing.
- Match the schema to the activity kind; the wrong one flags valid fields.
- A fragment library has its OWN schema and does NOT share the tutor's. Pointing a
  fragment file at the tutor schema underlines perfectly valid fields.
- The extension is a one-time install; the schema is fetched over the network.
- The activity registry (the file `codes sync` reads, covered in "Many activities at
  once") has a schema too. Mention it briefly with its modeline; the registry itself
  belongs to that chapter, so do not explain the format here.

Look: the module READMEs' editor-support sections, the schema files, line 1 of the
example activities, docs/registry.md and cli/README.md for the registry modeline, the
Red Hat vscode-yaml extension page.
