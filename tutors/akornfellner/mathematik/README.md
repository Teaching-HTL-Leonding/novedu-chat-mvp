# Mathematik-Tutoren (migriert aus der Prompt-Datenbank)

Diese Dateien sind die Übersetzung von `prompt-database/mathematik` (Autor:
a.kornfellner) in das Tutor-/Fragment-Format dieses Repos (siehe
[`tutors/README.md`](../../README.md)).

## Abbildung der Konzepte

| Prompt-Datenbank                          | Hier                                                                 |
| ----------------------------------------- | -------------------------------------------------------------------- |
| `_bausteine/**/*.md` (Snippets)            | Fragmente in `mathematik-fragments.yaml`                              |
| `rollen/*.md` (Rollen-Prompts)             | je eine Tutor-Datei (`*-tutor.yaml`)                                  |
| `{{BAUSTEIN:name}}`                        | Fragment-Referenz unter `prompt.fragments`                            |
| `{{STOFF}}` (austauschbarer Lernstoff)     | Variable `stoff` des Fragments `stoff_kontext` in der Tutor-Datei     |
| Abschnitts-Skelett (`# Rolle`, …)          | parametrisierte Fragmente `rolle`, `didaktische_regeln`, `grenzfaelle` |
| —                                          | zusätzlich: `school_kids_safety` aus `../../general-fragments.yaml`   |

## Die drei Tutoren

- **`nachhilfelehrer-tutor.yaml`** — sokratischer Nachhilfelehrer; der Baustein
  `sokratisch_keine_loesungen` ist hier Pflicht (`required: true`).
- **`beispiel-creator-tutor.yaml`** — erstellt neue Übungsaufgaben zum Stoff.
- **`pruefungsvorbereitung-tutor.yaml`** — erklärt Buchbeispiele, erstellt analoge
  Aufgaben, simuliert Prüfungen.

## Stoff austauschen

Der Lernstoff steht in jeder Tutor-Datei unter dem Fragment `stoff_kontext` in
der Variable `stoff` (aktuell ein Beispiel: quadratische Gleichungen, 6. Klasse).
Pro Thema/Schularbeit kopiert man die Tutor-Datei und ersetzt nur diesen Block —
das entspricht dem `--stoff`-Parameter des geplanten Build-Skripts der
Prompt-Datenbank.

## Validierung

Offline: `npx vitest run --project unit scripts/validate-local-tutors.unit.test.ts`
prüft alle drei Tutoren mit der echten Pipeline gegen die lokalen Dateien.
Nach dem Pushen funktioniert wie gewohnt die **Validate-Tutor**-Seite mit der
Raw-GitHub-URL der Tutor-Datei.
