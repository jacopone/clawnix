import { z } from "zod";
import type { ClawNixPlugin, PluginContext } from "../../core/types.js";
import type { AgentBroker } from "../../core/agent-broker.js";

interface DelegationConfig {
  agentName: string;
  broker: AgentBroker;
}

export class DelegationPlugin implements ClawNixPlugin {
  name = "delegation";
  version = "0.1.0";

  async init(ctx: PluginContext): Promise<void> {
    const config = ctx.config as unknown as DelegationConfig;
    const { agentName, broker } = config;

    ctx.registerTool({
      name: "clawnix_delegate",
      description:
        "Delegate a task to another agent. The target agent processes the task and returns a result. " +
        "Use clawnix_list_agents to see available agents.",
      inputSchema: z.object({
        targetAgent: z.string().describe("Name of the agent to delegate to"),
        task: z.string().describe("Description of the task to delegate"),
        context: z.string().optional().describe("Additional context for the target agent"),
      }),
      run: async (input) => {
        const { targetAgent, task, context } = input as {
          targetAgent: string;
          task: string;
          context?: string;
        };
        const response = await broker.delegate({
          from: agentName,
          to: targetAgent,
          task,
          context,
        });
        return JSON.stringify(response);
      },
    });

    ctx.registerTool({
      name: "clawnix_list_agents",
      description: "List all available agents that can receive delegated tasks",
      inputSchema: z.object({}),
      run: async () => {
        const agents = broker.listAgents();
        return agents.length > 0
          ? `Available agents: ${agents.join(", ")}`
          : "No other agents registered.";
      },
    });

    ctx.logger.info(`Delegation plugin registered for agent "${agentName}"`);
  }

  async shutdown(): Promise<void> {}
}
