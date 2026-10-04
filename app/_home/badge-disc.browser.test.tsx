import { describe, expect, test } from "vitest";
import { render } from "vitest-browser-react";

// Every badge family's disc in a real browser, with the real stylesheet: each
// family the catalog ships — the students' and the teachers' — must resolve to
// its own colour token (a missing `--fam-*` token renders no disc at all), and
// the glyph must stand out from it (WCAG 1.4.11: 3:1 for graphics).
import "@/app/globals.css";
import { STUDENT_FAMILIES, TEACHER_FAMILIES } from "@/lib/achievements/catalog";
import { BadgeDisc } from "./badge-disc";

type Rgb = [number, number, number];

function parseRgb(value: string): Rgb | undefined {
  const match = value.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/);
  if (!match || match[4] === "0") return undefined;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function luminance([r, g, b]: Rgb): number {
  const [lr, lg, lb] = [r, g, b].map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  }) as Rgb;
  return 0.2126 * lr + 0.7152 * lg + 0.0722 * lb;
}

function contrast(a: Rgb, b: Rgb): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

const FAMILIES = [...STUDENT_FAMILIES, ...TEACHER_FAMILIES].map((f) => f.id);

/** The disc rendered inside the wrapper with this test id. */
function discOf(testId: string): HTMLElement {
  const disc = document.querySelector(`[data-testid="${testId}"] > span`);
  if (!(disc instanceof HTMLElement)) throw new Error(`no disc for ${testId}`);
  return disc;
}

describe("BadgeDisc colours", () => {
  test("every family has its own disc colour, and the glyph reaches 3:1 on it", async () => {
    await render(
      <div>
        {FAMILIES.map((family) => (
          <span key={family} data-testid={family}>
            <BadgeDisc icon="star" family={family} />
          </span>
        ))}
      </div>,
    );
    const backgrounds = new Set<string>();
    for (const family of FAMILIES) {
      const style = getComputedStyle(discOf(family));
      const background = parseRgb(style.backgroundColor);
      expect(background, `${family}: disc colour`).toBeDefined();
      const glyph = parseRgb(style.color);
      expect(glyph, `${family}: glyph colour`).toBeDefined();
      expect(
        contrast(background as Rgb, glyph as Rgb),
        `${family}: glyph contrast`,
      ).toBeGreaterThanOrEqual(3);
      backgrounds.add(style.backgroundColor);
    }
    // No two families share a colour.
    expect(backgrounds.size).toBe(FAMILIES.length);
  });

  test("a locked disc is the card colour with an outline, whatever the family", async () => {
    await render(
      <span data-testid="locked">
        <BadgeDisc icon="users" family="reach" locked />
      </span>,
    );
    const disc = discOf("locked");
    expect(disc.className).not.toContain("bg-fam-reach");
    expect(parseRgb(getComputedStyle(disc).backgroundColor)).toEqual([255, 255, 255]);
  });
});
