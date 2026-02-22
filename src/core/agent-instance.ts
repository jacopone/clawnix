import { EventBus } from "./event-bus.js";
import { StateStore } from "./state.js";
import { PluginHost } from "./plugin-host.js";
import { mkdirSync } from "node:fs";
import type { AgentInstanceConfig } from "./config.js";

export interface AgentInstance {
  name: string;
  description: string;
  eventBus: EventBus;
  state: StateStore;
  pluginHost: PluginHost;
  shutdown: () => Promise<void>;
}

export async function createAgentInstance(
  name: string,
  agentConfig: AgentInstanceConfig,
  globalConfig: { stateDir: string },
): Promise<AgentInstance> {
  const stateDir = `${globalConfig.stateDir}/${name}`;
  mkdirSync(stateDir, { recursive: true });
  mkdirSync(agentConfig.workspaceDir, { recursive: true });

  const eventBus = new EventBus();
  const state = new StateStore(`${stateDir}/clawnix.db`);
  const pluginHost = new PluginHost(eventBus, state);

  if (agentConfig.toolPolicies.length > 0) {
    pluginHost.setPolicies(agentConfig.toolPolicies);
  }

  return {
    name,
    description: agentConfig.description,
    eventBus,
    state,
    pluginHost,
    shutdown: async () => {
      await pluginHost.shutdownAll();
      state.close();
    },
  };
}
