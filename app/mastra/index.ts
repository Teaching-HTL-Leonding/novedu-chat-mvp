import { Mastra } from "@mastra/core/mastra";
import { MastraCompositeStore } from "@mastra/core/storage";
import { MemoryLibSQL } from "@mastra/libsql";
import { PinoLogger } from "@mastra/loggers";
import { weatherAgent } from "./agents/weather-agent";
import { buildScchAgents } from "./scch";

export const mastra = new Mastra({
  // One agent per SCCH (vLLM) chat model, plus the demo weather agent. The
  // frontend's model dropdown picks among the SCCH agents by `agentId`.
  agents: { weatherAgent, ...buildScchAgents() },
  // Route the `memory` domain to an in-memory LibSQL store. `:memory:` keeps
  // everything in RAM for the lifetime of the process — no database file on disk.
  storage: new MastraCompositeStore({
    id: "mastra-storage",
    domains: {
      memory: new MemoryLibSQL({ url: ":memory:" }),
    },
  }),
  logger: new PinoLogger({
    name: "Mastra",
    level: "info",
  }),
});
