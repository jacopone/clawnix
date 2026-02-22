import { loadConfig } from "./core/config.js";
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
import { mkdirSync } from "node:fs";

async function main() {
  console.log("ClawNix v0.2.0 — starting...\n");

  const config = loadConfig();

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

  // Phase 2: Observation tools (processes, resources, journal, network, read_file, query)
  if (config.tools.observe.enable) {
    await pluginHost.register(new ObservePlugin(), config.tools.observe as unknown as Record<string, unknown>);
  }

  // Phase 2: Heartbeat service (reads HEARTBEAT.md periodically)
  await pluginHost.register(new HeartbeatPlugin(), { workspaceDir: config.workspaceDir });

  // Phase 2: Tool policies
  if (config.security.policies.length > 0) {
    pluginHost.setPolicies(config.security.policies);
  }

  // Expire stale approval requests every 60 seconds
  const approvalStore = new ApprovalStore(state);
  const approvalCleanupInterval = setInterval(() => {
    approvalStore.expireOlderThan(config.security.approvalTimeoutSeconds * 1000);
  }, 60_000);

  // Connect to external MCP servers
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

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
