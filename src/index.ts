import { loadConfig } from "./core/config.js";
import type { AgentInstanceConfig } from "./core/config.js";
import { EventBus } from "./core/event-bus.js";
import { StateStore } from "./core/state.js";
import { PluginHost } from "./core/plugin-host.js";
import { Agent } from "./core/agent.js";
import { TerminalChannel } from "./channels/terminal/index.js";
import { TelegramChannel } from "./channels/telegram/index.js";
import { NixOSToolsPlugin } from "./tools/nixos/index.js";
import { WebUIChannel } from "./channels/webui/index.js";
import { McpClientManager } from "./core/mcp-client.js";
import { DevToolsPlugin } from "./tools/dev/index.js";
import { SchedulerPlugin } from "./tools/scheduler/index.js";
import { ObservePlugin } from "./tools/observe/index.js";
import { HeartbeatPlugin } from "./tools/heartbeat/index.js";
import { ApprovalStore } from "./core/approval.js";
import { Router } from "./core/router.js";
import type { AgentRoute } from "./core/router.js";
import { createAgentInstance, wireAgentInstance } from "./core/agent-instance.js";
import type { AgentInstance, WiredAgentInstance } from "./core/agent-instance.js";
import { AgentBroker } from "./core/agent-broker.js";
import { UsageTracker } from "./core/usage.js";
import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import Database from "better-sqlite3";

export function buildAgentRoutes(
  agents: Record<string, AgentInstanceConfig>,
): Record<string, AgentRoute> {
  const routes: Record<string, AgentRoute> = {};
  const usedPrefixes = new Set<string>();

  for (const [name, config] of Object.entries(agents)) {
    let prefix = name[0].toLowerCase();
    if (usedPrefixes.has(prefix)) {
      for (let i = 1; i < name.length; i++) {
        if (!usedPrefixes.has(name[i].toLowerCase())) {
          prefix = name[i].toLowerCase();
          break;
        }
      }
    }
    usedPrefixes.add(prefix);
    routes[name] = { description: config.description, prefix };
  }

  return routes;
}

async function startMultiAgent(config: ReturnType<typeof loadConfig>) {
  console.log("ClawNix v0.2.0 — starting in multi-agent mode...\n");

  mkdirSync(config.stateDir, { recursive: true });

  // Shared DB for delegation audit (all agents share stateDir)
  const sharedDb = new Database(`${config.stateDir}/clawnix-shared.db`);
  sharedDb.pragma("journal_mode = WAL");
  sharedDb.exec(`
    CREATE TABLE IF NOT EXISTS delegation_audit (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      from_agent TEXT NOT NULL,
      to_agent TEXT NOT NULL,
      task TEXT NOT NULL,
      status TEXT NOT NULL,
      result TEXT NOT NULL,
      duration_ms INTEGER NOT NULL,
      timestamp TEXT NOT NULL
    )
  `);
  const insertAudit = sharedDb.prepare(
    "INSERT INTO delegation_audit (from_agent, to_agent, task, status, result, duration_ms, timestamp) VALUES (?, ?, ?, ?, ?, ?, ?)",
  );

  const agents = config.agents!;
  const routes = buildAgentRoutes(agents);
  const router = new Router(routes);

  const broker = new AgentBroker({
    maxDepth: 3,
    auditRecorder: (record) => {
      insertAudit.run(record.fromAgent, record.toAgent, record.task, record.status, record.result, record.durationMs, record.timestamp);
    },
  });
  const instances: AgentInstance[] = [];
  const wired: WiredAgentInstance[] = [];

  for (const [name, agentConfig] of Object.entries(agents)) {
    const instance = await createAgentInstance(name, agentConfig, {
      stateDir: config.stateDir,
    });

    // Resolve MCP server configs from global config by name
    const mcpServerConfigs: Record<string, { command: string; args?: string[]; env?: Record<string, string> }> = {};
    for (const serverName of agentConfig.mcp.servers) {
      const serverConfig = config.mcp?.servers?.[serverName];
      if (serverConfig) {
        mcpServerConfigs[serverName] = serverConfig;
      } else {
        console.warn(`[multi-agent] MCP server "${serverName}" referenced by agent "${name}" not found in global config`);
      }
    }

    const wiredInstance = await wireAgentInstance(instance, agentConfig, mcpServerConfigs, {
      stateDir: config.stateDir,
    }, broker);

    // Register delegation handler so other agents can delegate tasks to this agent
    broker.registerAgent(name, async (request) => {
      const msg = {
        id: randomUUID(),
        channel: "delegation",
        sender: request.from,
        text: `[Delegated from ${request.from}] ${request.task}${request.context ? `\nContext: ${request.context}` : ""}`,
        timestamp: new Date(),
      };
      instance.eventBus.emit("message:incoming", msg);
      return `Task delegated to ${name}. The agent will process it asynchronously.`;
    });

    instances.push(instance);
    wired.push(wiredInstance);
    console.log(`  agent "${name}" (/${routes[name].prefix}) — ${agentConfig.description}`);
  }

  console.log(`\n${instances.length} agent(s) started. Router active.\n`);

  if (config.channels.telegram.enable) {
    console.log("Telegram channel enabled — messages will be routed to agents via prefix/classification");
  }

  const shutdown = async () => {
    console.log("\nShutting down all agents...");
    for (const w of wired) {
      await w.mcpManager.disconnectAll();
    }
    for (const instance of instances) {
      await instance.shutdown();
    }
    sharedDb.close();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  return { router, instances, wired };
}

async function startSingleAgent(config: ReturnType<typeof loadConfig>) {
  console.log("ClawNix v0.2.0 — starting...\n");

  mkdirSync(config.stateDir, { recursive: true });

  const eventBus = new EventBus();
  const state = new StateStore(`${config.stateDir}/clawnix.db`);
  const pluginHost = new PluginHost(eventBus, state);

  await pluginHost.register(new TerminalChannel(), {});

  if (config.channels.telegram.enable) {
    await pluginHost.register(new TelegramChannel(), config.channels.telegram as unknown as Record<string, unknown>);
  }

  if (config.channels.webui.enable) {
    await pluginHost.register(new WebUIChannel(), config.channels.webui as unknown as Record<string, unknown>);
  }

  if (config.tools.nixos.enable) {
    await pluginHost.register(new NixOSToolsPlugin(), config.tools.nixos as unknown as Record<string, unknown>);
  }

  if (config.tools.dev.enable) {
    await pluginHost.register(new DevToolsPlugin(), {});
  }

  await pluginHost.register(new SchedulerPlugin(), {});

  if (config.tools.observe.enable) {
    await pluginHost.register(new ObservePlugin(), config.tools.observe as unknown as Record<string, unknown>);
  }

  await pluginHost.register(new HeartbeatPlugin(), { workspaceDir: config.workspaceDir });

  if (config.security.policies.length > 0) {
    pluginHost.setPolicies(config.security.policies);
  }

  const approvalStore = new ApprovalStore(state);
  const approvalCleanupInterval = setInterval(() => {
    approvalStore.expireOlderThan(config.security.approvalTimeoutSeconds * 1000);
  }, 60_000);

  const mcpManager = new McpClientManager(config.mcp?.servers ?? {});
  await mcpManager.connectAll();
  const mcpTools = await mcpManager.getAllTools();
  for (const tool of mcpTools) {
    pluginHost.registerExternalTool(tool);
  }

  await pluginHost.initAll();

  const _agent = new Agent(config, eventBus, state, pluginHost);

  const shutdown = async () => {
    console.log("\nShutting down...");
    clearInterval(approvalCleanupInterval);
    await pluginHost.shutdownAll();
    await mcpManager.disconnectAll();
    state.close();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

async function main() {
  const config = loadConfig();

  if (config.agents && Object.keys(config.agents).length > 0) {
    await startMultiAgent(config);
  } else {
    await startSingleAgent(config);
  }
}

const isDirectRun =
  process.argv[1] &&
  import.meta.url.endsWith(process.argv[1].replace(/.*\//, ""));

if (isDirectRun) {
  main().catch((err) => {
    console.error("Fatal:", err);
    process.exit(1);
  });
}
