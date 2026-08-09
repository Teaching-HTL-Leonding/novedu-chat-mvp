// Mastra bindings for the pure tutor-tool catalog (lib/tutor-tools). This is
// the ONLY place tool defs meet `createTool`: the catalog stays framework-free
// (and CLI-bundlable), while every Mastra `Tool` instance is created once at
// module load — tools are stateless, so instances are safely shared across
// requests and the per-request `tools` resolver just picks a subset.

import { createTool, type ToolAction } from "@mastra/core/tools";
import {
  defaultTutorToolDeps,
  TUTOR_TOOL_NAMES,
  type TutorToolName,
  tutorToolCatalog,
} from "@/lib/tutor-tools";

// biome-ignore lint/suspicious/noExplicitAny: heterogeneous tool map — per-tool types live on each instance.
type AnyMastraTool = ToolAction<any, any, any, any, any>;

const mastraTutorTools: Record<TutorToolName, AnyMastraTool> = Object.fromEntries(
  TUTOR_TOOL_NAMES.map((name) => {
    const def = tutorToolCatalog[name];
    return [
      name,
      createTool({
        id: def.name,
        description: def.description,
        inputSchema: def.inputSchema,
        outputSchema: def.outputSchema,
        execute: async (input) => def.execute(input, defaultTutorToolDeps),
      }),
    ];
  }),
) as Record<TutorToolName, AnyMastraTool>;

/**
 * The Mastra toolset for a tutor's validated `tools:` selection. Takes plain
 * strings (the `BuildResult.tools` shape) and fails loud on an unknown name —
 * the schema already rejects those at load time, so hitting this throw means a
 * wiring bug, not bad authoring input.
 */
export function selectTutorTools(names: readonly string[]): Record<string, AnyMastraTool> {
  const toolset: Record<string, AnyMastraTool> = {};
  for (const name of names) {
    const tool = mastraTutorTools[name as TutorToolName];
    if (!tool) throw new Error(`Unknown tutor tool: ${name}`);
    toolset[name] = tool;
  }
  return toolset;
}
