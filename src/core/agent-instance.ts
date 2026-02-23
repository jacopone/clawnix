import { EventBus } from "./event-bus.js";
import { StateStore } from "./state.js";
import { PluginHost } from "./plugin-host.js";
import { Agent } from "./agent.js";
import { McpClientManager } from "./mcp-client.js";
import type { McpServerConfig } from "./mcp-client.js";
import { NixOSToolsPlugin } from "../tools/nixos/index.js";
import { DevToolsPlugin } from "../tools/dev/index.js";
import { SchedulerPlugin } from "../tools/scheduler/index.js";
import { ObservePlugin } from "../tools/observe/index.js";
import { HeartbeatPlugin } from "../tools/heartbeat/index.js";
import { MemoryPlugin } from "../tools/memory/index.js";
import { DirectivesPlugin } from "../tools/directives/index.js";
import { DelegationPlugin } from "../tools/delegation/index.js";
import { WatchdogPlugin } from "../tools/watchdog/index.js";
import { ExecPlugin } from "../tools/exec/index.js";
import { GooglePlugin } from "../tools/google/index.js";
import { BrowserPlugin } from "../tools/browser/index.js";
import { EvolvePlugin } from "../tools/evolve/index.js";
import { mkdirSync } from "node:fs";
import type { AgentInstanceConfig } from "./config.js";
import type { AgentBroker } from "./agent-broker.js";

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

export interface WiredAgentInstance {
  agent: Agent;
  mcpManager: McpClientManager;
}

/**
 * Wire an AgentInstance with plugins, MCP tools, and a Claude Agent loop.
 * Registers plugins based on the agent's tools config, connects MCP servers,
 * initializes all plugins, and creates the Agent that listens for messages.
 */
export async function wireAgentInstance(
  instance: AgentInstance,
  agentConfig: AgentInstanceConfig,
  mcpServerConfigs: Record<string, McpServerConfig>,
  globalConfig?: { stateDir: string },
  broker?: AgentBroker,
): Promise<WiredAgentInstance> {
  const { pluginHost } = instance;

  for (const toolName of agentConfig.tools) {
    switch (toolName) {
      case "nixos":
        await pluginHost.register(new NixOSToolsPlugin(), {});
        break;
      case "dev":
        await pluginHost.register(new DevToolsPlugin(), {});
        break;
      case "scheduler":
        await pluginHost.register(new SchedulerPlugin(), {});
        break;
      case "observe":
        await pluginHost.register(new ObservePlugin(), {});
        break;
      case "heartbeat":
        await pluginHost.register(new HeartbeatPlugin(), {
          workspaceDir: agentConfig.workspaceDir,
        });
        break;
      case "memory":
        await pluginHost.register(new MemoryPlugin(), {
          workspaceDir: agentConfig.workspaceDir,
        });
        break;
      case "directives":
        await pluginHost.register(new DirectivesPlugin(), {});
        break;
      case "delegation":
        if (broker) {
          await pluginHost.register(new DelegationPlugin(), {
            agentName: instance.name,
            broker,
          });
        }
        break;
      case "watchdog":
        await pluginHost.register(new WatchdogPlugin(), {});
        break;
      case "exec":
        await pluginHost.register(new ExecPlugin(), agentConfig.exec ?? {});
        break;
      case "google":
        await pluginHost.register(new GooglePlugin(), agentConfig.google ?? {});
        break;
      case "browser":
        await pluginHost.register(new BrowserPlugin(), agentConfig.browser ?? {});
        break;
      case "evolve":
        await pluginHost.register(new EvolvePlugin(), agentConfig.evolve ?? {});
        break;
      default:
        console.warn(`[agent-instance] Unknown tool "${toolName}" for agent "${instance.name}", skipping`);
    }
  }

  const mcpManager = new McpClientManager(mcpServerConfigs);
  await mcpManager.connectAll();
  const mcpTools = await mcpManager.getAllTools();
  for (const tool of mcpTools) {
    pluginHost.registerExternalTool(tool);
  }

  await pluginHost.initAll();

  const agent = new Agent(agentConfig, instance.eventBus, instance.state, pluginHost, globalConfig?.stateDir, instance.name);

  return { agent, mcpManager };
}
