export * from "./agent-tool.types";
export * from "./agent-tool-registry";
export * from "./agent-tool-executor";
export * from "./agent-chat.types";
export * from "./openai-agent-client";

import { createAgentToolRegistry } from "./agent-tool-registry";
import { AgentToolExecutor } from "./agent-tool-executor";

export const agentToolRegistry = createAgentToolRegistry();
export const agentToolExecutor = new AgentToolExecutor(agentToolRegistry);
