import { Mastra } from "@mastra/core/mastra";
import { MastraCompositeStore } from "@mastra/core/storage";
import { MemoryLibSQL } from "@mastra/libsql";
import { PinoLogger } from "@mastra/loggers";
import { weatherAgent } from "./agents/weather-agent";
import { tutorAgent } from "./tutor-agent";

export const mastra = new Mastra({
  // The `tutor` agent is configured per request from a tutor-definition YAML
  // (system prompt + model). `weatherAgent` stays as a tool-using demo.
  // NOTE: the registry KEY (not the agent's `id`) is the AG-UI agentId the
  // frontend references — so this must be `tutor` to match `agentId="tutor"`.
  agents: { weatherAgent, tutor: tutorAgent },
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
