// The host-template engine: an activity's host text (tutor_instructions /
// instructions) becomes a real Handlebars template the moment the activity declares
// any `fragment_files:`. Inline `{{fragment "alias.id" key="v" flag=true
// items=(array "a" "b")}}` markers insert parameterized fragments exactly where the
// author places them — there is no ordering concept; order is textual position.
//
// This is the THIRD (and last) legal `handlebars` importer, alongside `assemble.ts`
// and `fragment.ts` (see docs/prompt-fragments.md, enforced by
// `isolation.unit.test.ts`). It owns an ISOLATED `Handlebars.create()` instance so
// the `fragment` / `array` helpers exist ONLY when rendering host text — never when
// a fragment's own `content` is rendered (`assemble.ts` uses the default instance,
// which has no `fragment` helper, so a fragment calling `{{fragment}}` itself fails
// closed under strict mode — nesting is out of scope by design).

import Handlebars from "handlebars";
import { error, type ValidationError } from "./errors";
import type { VariableValue } from "./schemas";

/**
 * Resolves one placement to its final rendered text: given the `"alias.id"` reference
 * and the inline args, look up the fragment, merge args over its `input_schema`
 * defaults, and render its `content`. Throws to fail closed (an unresolved reference
 * blocks the activity rather than silently vanishing). Supplied by `load.ts`, which
 * builds it over the same `resolveAndMerge` that `checkPlacements` validates with, so
 * validation and render can never drift.
 */
export type FragmentResolver = (ref: string, args: Record<string, VariableValue>) => string;

/**
 * Resolves one `{{file "alias" from= to=}}` placement to its spliced text: given the bare
 * alias and the optional 1-based inclusive line range, look up the prefetched body and
 * return it verbatim (no range) or the sliced excerpt. Throws to fail closed (a missing
 * prefetched body blocks the activity rather than silently vanishing). Supplied by
 * `load.ts` over the same `sliceLines` semantics `checkPlacements` bounds-checks with.
 */
export type FileResolver = (alias: string, from?: number, to?: number) => string;

/**
 * One inline marker extracted from the host text, in textual order. `kind` discriminates
 * a `{{fragment}}` placement (`ref` = `"alias.id"`, `args` populated) from a `{{file}}`
 * placement (`ref` = the bare alias, `args` always `{}`, optional `from` / `to`).
 */
export interface Placement {
  /** Which marker this is — a fragment reference or a text-file embed. */
  kind: "fragment" | "file";
  /** The raw reference: `"alias.id"` for a fragment (split at the first dot), a bare alias for a file. */
  ref: string;
  /** Inline hash args: strings / booleans natively, string arrays via `(array …)`. Always `{}` for a file. */
  args: Record<string, VariableValue>;
  /** File placements only: 1-based inclusive start line of the range (`{{file … from=N}}`). */
  from?: number;
  /** File placements only: 1-based inclusive end line of the range (`{{file … to=N}}`). */
  to?: number;
  /** 1-based line of the marker (from the parsed AST `loc`). */
  line: number;
  /** 1-based column of the marker. */
  column: number;
}

export interface ParseHostResult {
  placements: Placement[];
  /** HOST_TEMPLATE_PARSE_ERROR (whole-template) or FRAGMENT_REF_NOT_LITERAL (per marker). */
  errors: ValidationError[];
}

// --- Minimal structural views of the Handlebars AST nodes we read. The real types
// live in `hbs.AST`, but structural typing keeps this readable and version-tolerant.
interface Loc {
  start: { line: number; column: number };
}
interface PathExpr {
  type: "PathExpression";
  original: string;
}
interface StringLit {
  type: "StringLiteral";
  value: string;
}
interface BoolLit {
  type: "BooleanLiteral";
  value: boolean;
}
interface NumberLit {
  type: "NumberLiteral";
  value: number;
}
interface SubExpr {
  type: "SubExpression";
  path: PathExpr;
  params: ValueNode[];
  hash?: Hash;
  loc: Loc;
}
type ValueNode =
  | StringLit
  | BoolLit
  | NumberLit
  | SubExpr
  | PathExpr
  | { type: string; value?: unknown };
interface HashPair {
  key: string;
  value: ValueNode;
}
interface Hash {
  pairs: HashPair[];
}
interface CallNode {
  type: string;
  path?: PathExpr;
  params?: ValueNode[];
  hash?: Hash;
  program?: Program;
  inverse?: Program;
  loc: Loc;
}
interface Program {
  body: CallNode[];
}

const FRAGMENT_HELPER = "fragment";
const ARRAY_HELPER = "array";
const FILE_HELPER = "file";

const isFragmentNode = (node: CallNode | SubExpr): boolean =>
  node.path?.original === FRAGMENT_HELPER;
const isFileNode = (node: CallNode | SubExpr): boolean => node.path?.original === FILE_HELPER;

/** A structural `{{fragment}}` error stamped with the node's 1-based position. */
function markerInvalid(loc: Loc, detail: string): ValidationError {
  return error("FRAGMENT_MARKER_INVALID", `${detail} (line ${loc.start.line})`, {
    line: loc.start.line,
    column: loc.start.column + 1,
  });
}

/**
 * A structural `{{file}}` error stamped with the node's 1-based position. Every
 * `{{file}}` violation collapses to this ONE code (there is deliberately no separate
 * not-literal variant, unlike `{{fragment}}`): a file marker either parses into a valid
 * `alias`/`from`/`to` shape or fails closed here.
 */
function fileMarkerInvalid(loc: Loc, detail: string): ValidationError {
  return error("TEXT_FILE_MARKER_INVALID", `${detail} (line ${loc.start.line})`, {
    line: loc.start.line,
    column: loc.start.column + 1,
  });
}

/**
 * Read a hash-pair value into a supported literal. The supported set IS the contract:
 * a string, a boolean, or an `(array "…" …)` of string literals. Anything else — a
 * number, a path reference, a nested `(fragment …)`, an array with a non-string
 * element — is a hard error, because at RENDER time the real Handlebars runtime hands
 * the helper the raw value regardless, so silently dropping it here would let the
 * placement validate against different args than it renders with (fail-open drift).
 */
function readHashValue(
  key: string,
  node: ValueNode,
  loc: Loc,
): { value: VariableValue } | { error: ValidationError } {
  switch (node.type) {
    case "StringLiteral":
      return { value: (node as StringLit).value };
    case "BooleanLiteral":
      return { value: (node as BoolLit).value };
    case "SubExpression": {
      const sub = node as SubExpr;
      if (sub.path.original !== ARRAY_HELPER) {
        return {
          error: markerInvalid(loc, `Argument "${key}" must be a string, boolean, or (array …)`),
        };
      }
      if (!sub.params.every((p) => p.type === "StringLiteral")) {
        return {
          error: markerInvalid(loc, `Every element of (array …) for "${key}" must be a string`),
        };
      }
      return { value: (sub.params as StringLit[]).map((p) => p.value) };
    }
    default:
      return {
        error: markerInvalid(loc, `Argument "${key}" must be a string, boolean, or (array …)`),
      };
  }
}

/** Extract one inline `{{fragment "alias.id" …}}` mustache's ref + validated args. */
function extractInlineMarker(node: CallNode, out: ParseHostResult): void {
  const first = node.params?.[0];
  if (first?.type !== "StringLiteral") {
    out.errors.push(
      error(
        "FRAGMENT_REF_NOT_LITERAL",
        `A {{fragment}} marker at line ${node.loc.start.line} needs a quoted "alias.id" reference`,
        { line: node.loc.start.line, column: node.loc.start.column + 1 },
      ),
    );
    return;
  }
  if ((node.params?.length ?? 0) > 1) {
    out.errors.push(
      markerInvalid(node.loc, 'A {{fragment}} marker takes exactly one "alias.id" reference'),
    );
    return;
  }
  const args: Record<string, VariableValue> = {};
  for (const pair of node.hash?.pairs ?? []) {
    const read = readHashValue(pair.key, pair.value, node.loc);
    if ("error" in read) {
      out.errors.push(read.error);
      return; // don't record a placement with an unvalidated arg
    }
    args[pair.key] = read.value;
  }
  out.placements.push({
    kind: "fragment",
    ref: (first as StringLit).value,
    args,
    line: node.loc.start.line,
    column: node.loc.start.column + 1,
  });
}

/**
 * Extract one inline `{{file "alias" from=N to=M}}` mustache's alias + optional range.
 * Structural contract (all TEXT_FILE_MARKER_INVALID, recording no placement on failure):
 * the first positional must be a quoted string literal, there is exactly one positional,
 * hash keys are restricted to `from` / `to`, each value must be an integer NumberLiteral
 * >= 1, and when both are present `from <= to`. A `from`/`to` beyond the file's actual
 * line count is NOT checked here (that needs the fetched body — see `checkPlacements`).
 */
function extractFileMarker(node: CallNode, out: ParseHostResult): void {
  const first = node.params?.[0];
  if (first?.type !== "StringLiteral") {
    out.errors.push(
      fileMarkerInvalid(node.loc, 'A {{file}} marker needs a quoted "alias" reference'),
    );
    return;
  }
  if ((node.params?.length ?? 0) > 1) {
    out.errors.push(
      fileMarkerInvalid(node.loc, 'A {{file}} marker takes exactly one "alias" reference'),
    );
    return;
  }
  let from: number | undefined;
  let to: number | undefined;
  for (const pair of node.hash?.pairs ?? []) {
    if (pair.key !== "from" && pair.key !== "to") {
      out.errors.push(
        fileMarkerInvalid(
          node.loc,
          `A {{file}} marker accepts only from= / to=, not "${pair.key}"`,
        ),
      );
      return;
    }
    // The value MUST be a real Handlebars number literal, not a string like "12" — at
    // render the resolver receives the raw hash value, so a non-number would slice wrong.
    if (
      pair.value.type !== "NumberLiteral" ||
      !Number.isInteger((pair.value as NumberLit).value) ||
      (pair.value as NumberLit).value < 1
    ) {
      out.errors.push(
        fileMarkerInvalid(node.loc, `"${pair.key}" must be an integer line number >= 1`),
      );
      return;
    }
    if (pair.key === "from") from = (pair.value as NumberLit).value;
    else to = (pair.value as NumberLit).value;
  }
  if (from !== undefined && to !== undefined && from > to) {
    out.errors.push(
      fileMarkerInvalid(node.loc, `"from" (${from}) must not be greater than "to" (${to})`),
    );
    return;
  }
  out.placements.push({
    kind: "file",
    ref: (first as StringLit).value,
    args: {},
    ...(from !== undefined ? { from } : {}),
    ...(to !== undefined ? { to } : {}),
    line: node.loc.start.line,
    column: node.loc.start.column + 1,
  });
}

/** Reject a `fragment` / `file` helper used anywhere but a simple inline mustache. */
function visitExpression(node: ValueNode, out: ParseHostResult): void {
  if (node.type !== "SubExpression") return;
  const sub = node as SubExpr;
  if (isFragmentNode(sub)) {
    // `{{#if (fragment "a.b")}}` — the helper WOULD run at render, unvalidated.
    out.errors.push(
      markerInvalid(
        sub.loc,
        "{{fragment}} must be a standalone inline marker, not a subexpression",
      ),
    );
  } else if (isFileNode(sub)) {
    // `{{#if (file "a")}}` — the file helper WOULD run at render, unvalidated. Fail closed.
    out.errors.push(
      fileMarkerInvalid(
        sub.loc,
        "{{file}} must be a standalone inline marker, not a subexpression",
      ),
    );
  }
  for (const p of sub.params ?? []) visitExpression(p, out);
  for (const pair of sub.hash?.pairs ?? []) visitExpression(pair.value, out);
}

/** Collect every `{{fragment}}` / `{{file}}` marker in a program body (recursing into blocks). */
function collectPlacements(program: Program, out: ParseHostResult): void {
  for (const node of program.body) {
    if (isFragmentNode(node)) {
      if (node.type === "MustacheStatement") {
        extractInlineMarker(node, out);
      } else {
        // A block `{{#fragment}}…{{/fragment}}` — the inline helper never calls
        // `options.fn`, so its body would silently vanish. Fail closed.
        out.errors.push(
          markerInvalid(
            node.loc,
            "{{fragment}} must be a simple inline marker, not a block {{#fragment}}…{{/fragment}}",
          ),
        );
      }
    } else if (isFileNode(node)) {
      if (node.type === "MustacheStatement") {
        extractFileMarker(node, out);
      } else {
        // A block `{{#file}}…{{/file}}` — the inline helper never calls `options.fn`,
        // so its body would silently vanish. Fail closed.
        out.errors.push(
          fileMarkerInvalid(
            node.loc,
            "{{file}} must be a simple inline marker, not a block {{#file}}…{{/file}}",
          ),
        );
      }
    } else {
      // Not a marker node: still walk its arguments for an illegal `(fragment …)` / `(file …)`.
      for (const p of node.params ?? []) visitExpression(p, out);
      for (const pair of node.hash?.pairs ?? []) visitExpression(pair.value, out);
    }
    // Recurse into block bodies so a marker inside `{{#if}}…{{/if}}` is still seen.
    if (node.program) collectPlacements(node.program, out);
    if (node.inverse) collectPlacements(node.inverse, out);
  }
}

/**
 * Parse the host text and extract every inline `{{fragment}}` placement in textual
 * order, WITHOUT rendering. A whole-template syntax error (a malformed marker, an
 * unescaped literal `{{`) becomes a single `HOST_TEMPLATE_PARSE_ERROR`; its position
 * is regexed out of Handlebars' message (`Parse error on line N:` — the parser
 * carries no structured position fields). A well-formed `{{fragment}}` marker whose
 * reference is not a quoted string literal becomes a per-marker `FRAGMENT_REF_NOT_LITERAL`;
 * a structurally wrong `{{file}}` marker becomes a per-marker `TEXT_FILE_MARKER_INVALID`.
 */
export function parseHostPlacements(text: string): ParseHostResult {
  const result: ParseHostResult = { placements: [], errors: [] };
  let program: Program;
  try {
    program = Handlebars.parse(text) as unknown as Program;
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    const lineMatch = message.match(/line (\d+)/i);
    result.errors.push(
      error("HOST_TEMPLATE_PARSE_ERROR", `Host text is not a valid template: ${message}`, {
        ...(lineMatch ? { line: Number(lineMatch[1]) } : {}),
      }),
    );
    return result;
  }
  collectPlacements(program, result);
  return result;
}

/** Build the isolated Handlebars instance carrying ONLY the `fragment` + `array` + `file` helpers. */
function createHostInstance(
  resolver: FragmentResolver,
  fileResolver: FileResolver,
): typeof Handlebars {
  const hb = Handlebars.create();
  hb.registerHelper(FRAGMENT_HELPER, (...args: unknown[]): string => {
    // Handlebars passes the options object last; the reference is the first positional.
    const ref = args.length >= 2 ? args[0] : undefined;
    if (typeof ref !== "string") {
      throw new Error('a {{fragment}} marker needs a quoted "alias.id" reference');
    }
    const options = args[args.length - 1] as { hash?: Record<string, VariableValue> };
    return resolver(ref, options?.hash ?? {});
  });
  hb.registerHelper(ARRAY_HELPER, (...args: unknown[]): unknown[] => {
    // Drop the trailing options object; the rest are the array elements.
    return args.slice(0, -1);
  });
  hb.registerHelper(FILE_HELPER, (...args: unknown[]): string => {
    // First positional is the alias; `from` / `to` arrive as hash number args. The
    // fetched body is spliced VERBATIM by the resolver — never re-compiled as Handlebars,
    // so a literal `{{` in course material survives untouched.
    const alias = args.length >= 2 ? args[0] : undefined;
    if (typeof alias !== "string") {
      throw new Error('a {{file}} marker needs a quoted "alias" reference');
    }
    const options = args[args.length - 1] as { hash?: { from?: number; to?: number } };
    return fileResolver(alias, options?.hash?.from, options?.hash?.to);
  });
  return hb;
}

/**
 * Compile + render the host text with the isolated instance under
 * `{ strict: true, noEscape: true }` — `strict` so any stray `{{…}}` that is not a
 * `fragment` / `array` / `file` marker fails closed instead of rendering empty; `noEscape`
 * so the prompt text (ASCII diagrams, quotes) passes through verbatim. Each `{{fragment}}`
 * placement is replaced by its `resolver` result, each `{{file}}` by its `fileResolver`
 * result. May throw — the caller wraps it as ASSEMBLY_ERROR. `fileResolver` defaults to a
 * thrower: a template with no `{{file}}` markers never invokes it, but one that does
 * without a resolver fails closed rather than rendering wrong.
 */
export function renderHostTemplate(
  text: string,
  resolver: FragmentResolver,
  fileResolver: FileResolver = () => {
    throw new Error("a {{file}} marker was rendered without a file resolver");
  },
): string {
  const hb = createHostInstance(resolver, fileResolver);
  const template = hb.compile(text, { strict: true, noEscape: true });
  return template({});
}
