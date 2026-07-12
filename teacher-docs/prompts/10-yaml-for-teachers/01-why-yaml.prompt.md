# The idea behind YAML

Output: teacher-docs/content/10-yaml-for-teachers/01-why-yaml.md · order 1

Job: A teacher about to author activities, wondering why they are plain-text YAML
files. After this chapter they see an activity as one readable file they can copy,
edit, and version, with no programming, and they are ready to learn the syntax next.

Cover:
- An activity is a single plain-text YAML file you write in any text editor.
- Why that is good: it reads clearly, you can copy a working example and change it, and
  it versions well (it fits GitHub and normal file workflows).
- The working mindset: start from an example that already works and change the parts
  you need; a validator catches mistakes before students see them (link forward to the
  schema and CLI chapters).

Get right:
- Keep this motivational and conceptual. The syntax itself is the next chapter, and the
  field-by-field references live in "Building activities"; link forward, do not teach
  fields here.
- Be honest that YAML cares about indentation, so small mistakes matter; the next
  chapter shows how to avoid them.

Look: activities/README.md, the module READMEs' framing of "you do not need to be a
programmer".
