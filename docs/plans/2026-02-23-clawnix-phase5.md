# ClawNix Phase 5: Multi-Agent Split + Proactive Behavior — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Complete the multi-agent wiring so multiple specialized agents actually run, add per-agent memory with write capability, make the scheduler persistent, add standing directives for proactive behavior, and integrate Google Calendar.

**Architecture:** Phase 3 built the infrastructure (agent-instance factory, router, NixOS module) but left `startMultiAgent` as a skeleton. This phase completes the wiring: each agent instance gets its own plugins, MCP clients, Claude loop, and a shared Telegram channel dispatches via the router. Memory becomes read-write via a new plugin. The scheduler migrates to StateStore for persistence, and a new directives plugin enables "when X happens, do Y" proactive behavior.

**Tech Stack:** TypeScript (core), Python + FastMCP (mcp-calendar), Vitest (tests), Nix (packaging)

---

## Task 1: Complete multi-agent wiring in startMultiAgent

The current `startMultiAgent` in `src/index.ts:46-85` creates agent instances but never registers plugins, MCP clients, or Claude agents. Fix this so each agent is fully operational.

**Files:**
- Modify: `src/index.ts`
- Modify: `src/core/agent-instance.ts`
- Modify: `src/core/agent.ts`
- Create: `src/core/agent-instance.test.ts` (extend existing)

**Step 1: Extend AgentInstance to include Agent creation**

The current `createAgentInstance` creates EventBus + StateStore + PluginHost. Extend it to also register plugins and create the Agent class. The Agent class constructor needs `AgentInstanceConfig` not just `ClawNixConfig`.

First, update `src/core/agent.ts` to accept `AgentInstanceConfig`:

```typescript
// src/core/agent.ts — updated constructor signature
import type { AgentInstanceConfig, ClawNixConfig } from "./config.js";

export class Agent {
  constructor(
    config: ClawNixConfig | AgentInstanceConfig,
    eventBus: EventBus,
    state: StateStore,
    pluginHost: PluginHost,
    workspaceDir?: string,
  ) {
    const wsDir = workspaceDir ?? (config as ClawNixConfig).workspaceDir ?? join(homedir(), ".config/clawnix");
    this.systemPrompt = loadPersonality(wsDir);
    const apiKey = readFileSync(config.ai.apiKeyFile, "utf-8").trim();
    this.claude = new ClaudeClient(apiKey, config.ai.model);
    this.conversations = new ConversationManager(state);
    // ... rest unchanged
  }
}
```

**Step 2: Create a `wireAgentInstance` function**

Add to `src/core/agent-instance.ts` a function that registers plugins and MCP servers for an agent instance:

```typescript
import { NixOSToolsPlugin } from "../tools/nixos/index.js";
import { DevToolsPlugin } from "../tools/dev/index.js";
import { SchedulerPlugin } from "../tools/scheduler/index.js";
import { ObservePlugin } from "../tools/observe/index.js";
import { HeartbeatPlugin } from "../tools/heartbeat/index.js";
import { McpClientManager } from "./mcp-client.js";
import { Agent } from "./agent.js";

export async function wireAgentInstance(
  instance: AgentInstance,
  agentConfig: AgentInstanceConfig,
  mcpServers: Record<string, { command: string; args?: string[]; env?: Record<string, string> }>,
): Promise<{ agent: Agent; mcpManager: McpClientManager }> {
  const { pluginHost } = instance;

  // Register tools based on config
  for (const tool of agentConfig.tools) {
    switch (tool) {
      case "nixos":
        await pluginHost.register(new NixOSToolsPlugin(), {});
        break;
      case "dev":
        await pluginHost.register(new DevToolsPlugin(), {});
        break;
      case "observe":
        await pluginHost.register(new ObservePlugin(), {});
        break;
      case "scheduler":
        await pluginHost.register(new SchedulerPlugin(), {});
        break;
      case "heartbeat":
        await pluginHost.register(new HeartbeatPlugin(), { workspaceDir: agentConfig.workspaceDir });
        break;
    }
  }

  // Connect MCP servers
  const mcpManager = new McpClientManager(mcpServers);
  await mcpManager.connectAll();
  const mcpTools = await mcpManager.getAllTools();
  for (const tool of mcpTools) {
    pluginHost.registerExternalTool(tool);
  }

  await pluginHost.initAll();

  // Create Agent (Claude loop)
  const agent = new Agent(agentConfig, instance.eventBus, instance.state, pluginHost, agentConfig.workspaceDir);

  return { agent, mcpManager };
}
```

**Step 3: Rewrite `startMultiAgent` to use `wireAgentInstance`**

```typescript
async function startMultiAgent(config: ReturnType<typeof loadConfig>) {
  console.log("ClawNix v0.2.0 — starting in multi-agent mode...\n");
  mkdirSync(config.stateDir, { recursive: true });

  const agents = config.agents!;
  const routes = buildAgentRoutes(agents);
  const router = new Router(routes);

  const instances: Array<{ instance: AgentInstance; mcpManager: McpClientManager }> = [];

  for (const [name, agentConfig] of Object.entries(agents)) {
    const instance = await createAgentInstance(name, agentConfig, {
      stateDir: config.stateDir,
    });

    // Resolve MCP servers: agent-specific servers from global mcp config
    const mcpServers: Record<string, { command: string; args?: string[]; env?: Record<string, string> }> = {};
    if (agentConfig.mcp?.servers) {
      for (const serverName of agentConfig.mcp.servers) {
        if (config.mcp.servers[serverName]) {
          mcpServers[serverName] = config.mcp.servers[serverName];
        }
      }
    }

    const wired = await wireAgentInstance(instance, agentConfig, mcpServers);
    instances.push({ instance, mcpManager: wired.mcpManager });
    console.log(`  agent "${name}" (/${routes[name].prefix}) — ${agentConfig.description}`);
  }

  console.log(`\n${instances.length} agent(s) started. Router active.\n`);

  const shutdown = async () => {
    console.log("\nShutting down all agents...");
    for (const { instance, mcpManager } of instances) {
      await instance.shutdown();
      await mcpManager.disconnectAll();
    }
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  return { router, instances };
}
```

**Step 4: Update AgentInstanceConfig to support MCP server names**

The current `AgentInstanceConfig.mcp.servers` is `string[]` (list of server names). The NixOS module passes the resolved MCP server configs in the JSON. Update the config handling to support both patterns:
- In NixOS module mode: server configs are already resolved in the JSON
- In multi-agent mode: `mcp.servers` can be server names referencing global config

Read `src/core/config.ts` and update:

```typescript
export interface AgentInstanceConfig {
  // ... existing fields ...
  mcp: {
    servers: string[] | Record<string, { command: string; args?: string[]; env?: Record<string, string> }>;
  };
}
```

**Step 5: Write tests for wireAgentInstance**

Add to `src/core/agent-instance.test.ts`:

```typescript
import { wireAgentInstance } from "./agent-instance.js";

describe("wireAgentInstance", () => {
  it("registers plugins for configured tools", async () => {
    // Create a minimal agent instance
    // Wire with tools: ["scheduler"]
    // Verify pluginHost has scheduler tools
  });

  it("registers MCP tools from connected servers", async () => {
    // Mock MCP server
    // Wire with mcpServers config
    // Verify external tools registered
  });
});
```

**Step 6: Run tests**

Run: `cd /home/guyfawkes/nixclaw && npx vitest run`
Expected: All existing 101 tests pass + new tests pass.

**Step 7: Commit**

```bash
git add src/core/agent.ts src/core/agent-instance.ts src/index.ts
git commit -m "feat: complete multi-agent wiring with per-agent plugins and Claude loop"
```

---

## Task 2: Per-agent memory with GLOBAL.md and write tools

Add a GLOBAL.md file read by all agents, and a MemoryPlugin that lets agents write to their own MEMORY.md.

**Files:**
- Modify: `src/core/personality.ts`
- Create: `src/tools/memory/index.ts`
- Create: `src/tools/memory/index.test.ts`

**Step 1: Write the tests**

```typescript
// src/tools/memory/index.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { MemoryPlugin } from "./index.js";
import { EventBus } from "../../core/event-bus.js";
import { StateStore } from "../../core/state.js";
import { PluginHost } from "../../core/plugin-host.js";
import { existsSync, readFileSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";

const TEST_DIR = "/tmp/clawnix-test-memory";
const WORKSPACE = join(TEST_DIR, "workspace");
const MEMORY_DIR = join(WORKSPACE, "memory");

describe("MemoryPlugin", () => {
  let eventBus: EventBus;
  let state: StateStore;
  let pluginHost: PluginHost;

  beforeEach(() => {
    mkdirSync(MEMORY_DIR, { recursive: true });
    eventBus = new EventBus();
    state = new StateStore(join(TEST_DIR, "test.db"));
    pluginHost = new PluginHost(eventBus, state);
  });

  afterEach(() => {
    state.close();
    rmSync(TEST_DIR, { recursive: true, force: true });
  });

  it("registers memory_read and memory_write tools", async () => {
    const plugin = new MemoryPlugin();
    await pluginHost.register(plugin, { workspaceDir: WORKSPACE });
    await pluginHost.initAll();
    const tools = pluginHost.getTools();
    const names = tools.map((t) => t.name);
    expect(names).toContain("clawnix_memory_read");
    expect(names).toContain("clawnix_memory_write");
  });

  it("reads MEMORY.md from workspace", async () => {
    writeFileSync(join(MEMORY_DIR, "MEMORY.md"), "# Agent Memory\nTest content");
    const plugin = new MemoryPlugin();
    await pluginHost.register(plugin, { workspaceDir: WORKSPACE });
    await pluginHost.initAll();
    const readTool = pluginHost.getTools().find((t) => t.name === "clawnix_memory_read");
    const result = await readTool!.run({});
    expect(result).toContain("Test content");
  });

  it("writes to MEMORY.md in workspace", async () => {
    const plugin = new MemoryPlugin();
    await pluginHost.register(plugin, { workspaceDir: WORKSPACE });
    await pluginHost.initAll();
    const writeTool = pluginHost.getTools().find((t) => t.name === "clawnix_memory_write");
    await writeTool!.run({ content: "# Learned\nThe user prefers dark mode." });
    const content = readFileSync(join(MEMORY_DIR, "MEMORY.md"), "utf-8");
    expect(content).toContain("dark mode");
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `cd /home/guyfawkes/nixclaw && npx vitest run src/tools/memory/index.test.ts`
Expected: FAIL — module not found.

**Step 3: Implement MemoryPlugin**

```typescript
// src/tools/memory/index.ts
import { z } from "zod";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import type { ClawNixPlugin, PluginContext } from "../../core/types.js";

interface MemoryConfig {
  workspaceDir: string;
  globalMemoryDir?: string;
}

export class MemoryPlugin implements ClawNixPlugin {
  name = "memory";
  version = "0.1.0";

  async init(ctx: PluginContext): Promise<void> {
    const config = ctx.config as unknown as MemoryConfig;
    const memoryDir = join(config.workspaceDir, "memory");
    mkdirSync(memoryDir, { recursive: true });
    const memoryFile = join(memoryDir, "MEMORY.md");

    ctx.registerTool({
      name: "clawnix_memory_read",
      description:
        "Read the agent's persistent memory file (MEMORY.md). Contains learned preferences, facts, and notes that persist across conversations.",
      inputSchema: z.object({}),
      run: async () => {
        if (!existsSync(memoryFile)) return "Memory is empty. Use memory_write to save information.";
        return readFileSync(memoryFile, "utf-8");
      },
    });

    ctx.registerTool({
      name: "clawnix_memory_write",
      description:
        "Write to the agent's persistent memory file (MEMORY.md). Use this to save learned preferences, important facts, or notes that should persist across conversations. Overwrites the entire file — read first if you want to append.",
      inputSchema: z.object({
        content: z.string().describe("Full content for MEMORY.md (markdown format)"),
      }),
      run: async (input) => {
        const { content } = input as { content: string };
        writeFileSync(memoryFile, content, "utf-8");
        return `Memory updated (${content.length} characters written to MEMORY.md).`;
      },
    });

    ctx.logger.info("Memory plugin registered");
  }

  async shutdown(): Promise<void> {}
}
```

**Step 4: Add GLOBAL.md support to personality.ts**

Update `src/core/personality.ts` to also load a GLOBAL.md from the parent stateDir:

```typescript
// src/core/personality.ts — add globalDir parameter
export function loadPersonality(workspaceDir: string, globalDir?: string): string {
  const identity = tryRead(join(workspaceDir, "IDENTITY.md"));
  if (!identity) return DEFAULT_PROMPT;

  const sections: string[] = [identity];

  // Global memory shared across all agents
  if (globalDir) {
    const global = tryRead(join(globalDir, "GLOBAL.md"));
    if (global) sections.push(`## Global Knowledge\n${global}`);
  }

  const soul = tryRead(join(workspaceDir, "SOUL.md"));
  if (soul) sections.push(`## Values & Behavior\n${soul}`);

  const user = tryRead(join(workspaceDir, "USER.md"));
  if (user) sections.push(`## User Preferences\n${user}`);

  const memory = tryRead(join(workspaceDir, "memory", "MEMORY.md"));
  if (memory) sections.push(`## Persistent Knowledge\n${memory}`);

  return sections.join("\n\n");
}
```

Update `src/core/agent.ts` to pass globalDir:

```typescript
// In Agent constructor:
this.systemPrompt = loadPersonality(
  wsDir,
  (config as any).stateDir ?? undefined,
);
```

**Step 5: Register MemoryPlugin in agent wiring**

In `src/core/agent-instance.ts`, add `memory` to the tool switch in `wireAgentInstance`:

```typescript
case "memory":
  await pluginHost.register(new MemoryPlugin(), { workspaceDir: agentConfig.workspaceDir });
  break;
```

**Step 6: Run all tests**

Run: `cd /home/guyfawkes/nixclaw && npx vitest run`
Expected: All tests pass.

**Step 7: Commit**

```bash
git add src/tools/memory/ src/core/personality.ts src/core/agent.ts src/core/agent-instance.ts
git commit -m "feat: add per-agent memory plugin with GLOBAL.md support"
```

---

## Task 3: Persistent scheduler

Migrate the scheduler from in-memory to StateStore so scheduled tasks survive restarts.

**Files:**
- Modify: `src/tools/scheduler/index.ts`
- Modify: `src/tools/scheduler/index.test.ts`

**Step 1: Write new tests for persistence**

Add to existing `src/tools/scheduler/index.test.ts`:

```typescript
it("persists tasks to StateStore", async () => {
  // Register scheduler with state
  // Schedule a task
  // Check StateStore has the task
  const stored = state.getJSON("scheduler", "tasks");
  expect(stored).toHaveLength(1);
  expect(stored[0].message).toBe("Check email");
});

it("restores tasks on init", async () => {
  // Pre-populate StateStore with a task
  state.setJSON("scheduler", "tasks", [{
    id: "test-1",
    cronExpression: "0 9 * * *",
    message: "Morning check",
    channel: "scheduler",
  }]);
  // Init scheduler
  // Verify task is running (list should show it)
  const listTool = pluginHost.getTools().find((t) => t.name === "clawnix_list_scheduled");
  const result = await listTool!.run({});
  expect(result).toContain("Morning check");
});

it("adds clawnix_remove_scheduled tool", async () => {
  const tools = pluginHost.getTools();
  expect(tools.map((t) => t.name)).toContain("clawnix_remove_scheduled");
});
```

**Step 2: Run tests to verify they fail**

Run: `cd /home/guyfawkes/nixclaw && npx vitest run src/tools/scheduler/index.test.ts`
Expected: FAIL.

**Step 3: Update scheduler implementation**

```typescript
// src/tools/scheduler/index.ts — updated with persistence
import { CronJob } from "cron";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import type { ClawNixPlugin, PluginContext, ClawNixMessage } from "../../core/types.js";
import type { StateStore } from "../../core/state.js";

interface StoredTask {
  id: string;
  cronExpression: string;
  message: string;
  channel: string;
}

interface RunningTask extends StoredTask {
  job: CronJob;
}

const NAMESPACE = "scheduler";
const TASKS_KEY = "tasks";

export class SchedulerPlugin implements ClawNixPlugin {
  name = "scheduler";
  version = "0.2.0";
  private tasks: RunningTask[] = [];
  private state?: StateStore;

  private persistTasks(): void {
    const stored: StoredTask[] = this.tasks.map(({ id, cronExpression, message, channel }) => ({
      id, cronExpression, message, channel,
    }));
    this.state?.setJSON(NAMESPACE, TASKS_KEY, stored);
  }

  private startTask(task: StoredTask, eventBus: any, logger: any): RunningTask {
    const job = new CronJob(task.cronExpression, () => {
      const msg: ClawNixMessage = {
        id: randomUUID(),
        channel: task.channel,
        sender: "scheduler",
        text: task.message,
        timestamp: new Date(),
      };
      eventBus.emit("message:incoming", msg);
      logger.info(`Scheduler triggered: ${task.id} — "${task.message}"`);
    });
    job.start();
    return { ...task, job };
  }

  async init(ctx: PluginContext): Promise<void> {
    const { eventBus, logger } = ctx;
    this.state = ctx.state;

    // Restore persisted tasks
    const stored = ctx.state.getJSON<StoredTask[]>(NAMESPACE, TASKS_KEY);
    if (stored) {
      for (const task of stored) {
        try {
          this.tasks.push(this.startTask(task, eventBus, logger));
          logger.info(`Restored scheduled task: ${task.id}`);
        } catch (err) {
          logger.warn(`Failed to restore task ${task.id}: ${err}`);
        }
      }
    }

    ctx.registerTool({
      name: "clawnix_schedule_task",
      description: "Schedule a recurring task using a cron expression. Persists across restarts.",
      inputSchema: z.object({
        cronExpression: z.string().describe("Cron expression (e.g. '0 9 * * *' for daily at 9am)"),
        message: z.string().describe("Message to send to the agent on each trigger"),
        channel: z.string().optional().describe("Channel to attribute the message to (default: scheduler)"),
      }),
      run: async (input) => {
        const { cronExpression, message, channel } = input as {
          cronExpression: string; message: string; channel?: string;
        };
        const task: StoredTask = {
          id: randomUUID().slice(0, 8),
          cronExpression,
          message,
          channel: channel ?? "scheduler",
        };
        this.tasks.push(this.startTask(task, eventBus, logger));
        this.persistTasks();
        return `Scheduled task ${task.id}: "${message}" with cron "${cronExpression}" (persisted)`;
      },
    });

    ctx.registerTool({
      name: "clawnix_list_scheduled",
      description: "List all currently scheduled tasks",
      inputSchema: z.object({}),
      run: async () => {
        if (this.tasks.length === 0) return "No scheduled tasks.";
        return this.tasks
          .map((t) => `${t.id}: "${t.message}" [${t.cronExpression}] (channel: ${t.channel})`)
          .join("\n");
      },
    });

    ctx.registerTool({
      name: "clawnix_remove_scheduled",
      description: "Remove a scheduled task by ID",
      inputSchema: z.object({
        taskId: z.string().describe("ID of the task to remove"),
      }),
      run: async (input) => {
        const { taskId } = input as { taskId: string };
        const idx = this.tasks.findIndex((t) => t.id === taskId);
        if (idx === -1) return `Task ${taskId} not found.`;
        this.tasks[idx].job.stop();
        this.tasks.splice(idx, 1);
        this.persistTasks();
        return `Removed task ${taskId}.`;
      },
    });

    logger.info(`Scheduler plugin registered (${this.tasks.length} restored)`);
  }

  async shutdown(): Promise<void> {
    for (const task of this.tasks) {
      task.job.stop();
    }
    this.tasks = [];
  }
}
```

**Step 4: Run tests**

Run: `cd /home/guyfawkes/nixclaw && npx vitest run`
Expected: All tests pass.

**Step 5: Commit**

```bash
git add src/tools/scheduler/
git commit -m "feat: make scheduler persistent with StateStore and add remove tool"
```

---

## Task 4: Standing directives plugin

Create a plugin that stores "when X happens, do Y" directives that are evaluated on scheduler ticks and incoming messages.

**Files:**
- Create: `src/tools/directives/index.ts`
- Create: `src/tools/directives/index.test.ts`

**Step 1: Write the tests**

```typescript
// src/tools/directives/index.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { DirectivesPlugin } from "./index.js";
import { EventBus } from "../../core/event-bus.js";
import { StateStore } from "../../core/state.js";
import { PluginHost } from "../../core/plugin-host.js";
import { rmSync, mkdirSync } from "node:fs";

const TEST_DIR = "/tmp/clawnix-test-directives";

describe("DirectivesPlugin", () => {
  let eventBus: EventBus;
  let state: StateStore;
  let pluginHost: PluginHost;

  beforeEach(() => {
    mkdirSync(TEST_DIR, { recursive: true });
    eventBus = new EventBus();
    state = new StateStore(`${TEST_DIR}/test.db`);
    pluginHost = new PluginHost(eventBus, state);
  });

  afterEach(() => {
    state.close();
    rmSync(TEST_DIR, { recursive: true, force: true });
  });

  it("registers directive tools", async () => {
    const plugin = new DirectivesPlugin();
    await pluginHost.register(plugin, {});
    await pluginHost.initAll();
    const names = pluginHost.getTools().map((t) => t.name);
    expect(names).toContain("clawnix_directive_create");
    expect(names).toContain("clawnix_directive_list");
    expect(names).toContain("clawnix_directive_remove");
  });

  it("creates and persists a directive", async () => {
    const plugin = new DirectivesPlugin();
    await pluginHost.register(plugin, {});
    await pluginHost.initAll();
    const createTool = pluginHost.getTools().find((t) => t.name === "clawnix_directive_create");
    const result = await createTool!.run({
      trigger: "cron:0 9 * * *",
      action: "Check my email inbox and summarize any urgent messages",
    });
    expect(result).toContain("created");

    // Verify persistence
    const stored = state.getJSON("directives", "all");
    expect(stored).toHaveLength(1);
  });

  it("lists directives", async () => {
    const plugin = new DirectivesPlugin();
    await pluginHost.register(plugin, {});
    await pluginHost.initAll();
    const createTool = pluginHost.getTools().find((t) => t.name === "clawnix_directive_create");
    await createTool!.run({
      trigger: "cron:0 9 * * *",
      action: "Morning email check",
    });
    const listTool = pluginHost.getTools().find((t) => t.name === "clawnix_directive_list");
    const result = await listTool!.run({});
    expect(result).toContain("Morning email check");
    expect(result).toContain("cron:0 9 * * *");
  });

  it("removes a directive", async () => {
    const plugin = new DirectivesPlugin();
    await pluginHost.register(plugin, {});
    await pluginHost.initAll();
    const createTool = pluginHost.getTools().find((t) => t.name === "clawnix_directive_create");
    const createResult = await createTool!.run({
      trigger: "cron:0 9 * * *",
      action: "Test action",
    });
    const id = JSON.parse(createResult).id;

    const removeTool = pluginHost.getTools().find((t) => t.name === "clawnix_directive_remove");
    const result = await removeTool!.run({ directiveId: id });
    expect(result).toContain("removed");

    const stored = state.getJSON("directives", "all");
    expect(stored).toHaveLength(0);
  });

  it("fires cron-based directives", async () => {
    const plugin = new DirectivesPlugin();
    await pluginHost.register(plugin, {});
    await pluginHost.initAll();

    const createTool = pluginHost.getTools().find((t) => t.name === "clawnix_directive_create");
    await createTool!.run({
      trigger: "interval:1",
      action: "Test periodic action",
    });

    // Manually trigger evaluation
    const messages: any[] = [];
    eventBus.on("message:incoming", (msg) => messages.push(msg));
    plugin.evaluateDirectives();

    // interval:1 means every 1 minute — evaluateDirectives should fire it
    expect(messages.length).toBeGreaterThanOrEqual(1);
    expect(messages[0].text).toContain("Test periodic action");
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `cd /home/guyfawkes/nixclaw && npx vitest run src/tools/directives/index.test.ts`
Expected: FAIL — module not found.

**Step 3: Implement DirectivesPlugin**

```typescript
// src/tools/directives/index.ts
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { CronJob } from "cron";
import type { ClawNixPlugin, PluginContext, ClawNixMessage } from "../../core/types.js";
import type { EventBus } from "../../core/event-bus.js";
import type { StateStore } from "../../core/state.js";
import type { Logger } from "../../core/types.js";

interface Directive {
  id: string;
  trigger: string;
  action: string;
  enabled: boolean;
  createdAt: string;
  lastFiredAt?: string;
}

const NAMESPACE = "directives";
const ALL_KEY = "all";

export class DirectivesPlugin implements ClawNixPlugin {
  name = "directives";
  version = "0.1.0";
  private state?: StateStore;
  private eventBus?: EventBus;
  private logger?: Logger;
  private cronJobs: Map<string, CronJob> = new Map();
  private evaluationInterval?: ReturnType<typeof setInterval>;

  private loadDirectives(): Directive[] {
    return this.state?.getJSON<Directive[]>(NAMESPACE, ALL_KEY) ?? [];
  }

  private saveDirectives(directives: Directive[]): void {
    this.state?.setJSON(NAMESPACE, ALL_KEY, directives);
  }

  evaluateDirectives(): void {
    const directives = this.loadDirectives();
    const now = new Date();

    for (const directive of directives) {
      if (!directive.enabled) continue;

      if (directive.trigger.startsWith("interval:")) {
        const minutes = parseInt(directive.trigger.split(":")[1], 10);
        const lastFired = directive.lastFiredAt ? new Date(directive.lastFiredAt) : null;
        const shouldFire = !lastFired || (now.getTime() - lastFired.getTime()) >= minutes * 60 * 1000;

        if (shouldFire) {
          this.fireDirective(directive);
          directive.lastFiredAt = now.toISOString();
        }
      }
    }

    this.saveDirectives(directives);
  }

  private fireDirective(directive: Directive): void {
    const msg: ClawNixMessage = {
      id: randomUUID(),
      channel: "directive",
      sender: "directive",
      text: `[Standing Directive ${directive.id}] ${directive.action}`,
      timestamp: new Date(),
    };
    this.eventBus?.emit("message:incoming", msg);
    this.logger?.info(`Directive fired: ${directive.id}`);
  }

  private setupCronDirective(directive: Directive): void {
    if (!directive.trigger.startsWith("cron:")) return;
    const cronExpr = directive.trigger.slice(5);

    try {
      const job = new CronJob(cronExpr, () => {
        this.fireDirective(directive);
        const all = this.loadDirectives();
        const d = all.find((d) => d.id === directive.id);
        if (d) {
          d.lastFiredAt = new Date().toISOString();
          this.saveDirectives(all);
        }
      });
      job.start();
      this.cronJobs.set(directive.id, job);
    } catch (err) {
      this.logger?.warn(`Invalid cron for directive ${directive.id}: ${err}`);
    }
  }

  async init(ctx: PluginContext): Promise<void> {
    this.state = ctx.state;
    this.eventBus = ctx.eventBus;
    this.logger = ctx.logger;

    // Restore cron-based directives
    const directives = this.loadDirectives();
    for (const d of directives) {
      if (d.enabled && d.trigger.startsWith("cron:")) {
        this.setupCronDirective(d);
      }
    }

    // Evaluate interval-based directives every minute
    this.evaluationInterval = setInterval(() => this.evaluateDirectives(), 60_000);

    ctx.registerTool({
      name: "clawnix_directive_create",
      description:
        "Create a standing directive — a persistent instruction that triggers automatically. " +
        "Trigger formats: 'cron:EXPRESSION' (e.g. 'cron:0 9 * * *' for daily at 9am), " +
        "'interval:MINUTES' (e.g. 'interval:30' for every 30 minutes).",
      inputSchema: z.object({
        trigger: z.string().describe("Trigger expression (e.g. 'cron:0 9 * * *' or 'interval:30')"),
        action: z.string().describe("What the agent should do when triggered"),
      }),
      run: async (input) => {
        const { trigger, action } = input as { trigger: string; action: string };
        const directive: Directive = {
          id: randomUUID().slice(0, 8),
          trigger,
          action,
          enabled: true,
          createdAt: new Date().toISOString(),
        };
        const all = this.loadDirectives();
        all.push(directive);
        this.saveDirectives(all);

        if (trigger.startsWith("cron:")) {
          this.setupCronDirective(directive);
        }

        return JSON.stringify({ status: "created", id: directive.id, trigger, action });
      },
    });

    ctx.registerTool({
      name: "clawnix_directive_list",
      description: "List all standing directives",
      inputSchema: z.object({}),
      run: async () => {
        const all = this.loadDirectives();
        if (all.length === 0) return "No standing directives.";
        return all
          .map((d) => `${d.id}: [${d.trigger}] ${d.action} (${d.enabled ? "enabled" : "disabled"}, last: ${d.lastFiredAt ?? "never"})`)
          .join("\n");
      },
    });

    ctx.registerTool({
      name: "clawnix_directive_remove",
      description: "Remove a standing directive by ID",
      inputSchema: z.object({
        directiveId: z.string().describe("ID of the directive to remove"),
      }),
      run: async (input) => {
        const { directiveId } = input as { directiveId: string };
        const all = this.loadDirectives();
        const idx = all.findIndex((d) => d.id === directiveId);
        if (idx === -1) return `Directive ${directiveId} not found.`;

        all.splice(idx, 1);
        this.saveDirectives(all);

        const job = this.cronJobs.get(directiveId);
        if (job) {
          job.stop();
          this.cronJobs.delete(directiveId);
        }

        return JSON.stringify({ status: "removed", id: directiveId });
      },
    });

    ctx.logger.info(`Directives plugin registered (${directives.length} restored)`);
  }

  async shutdown(): Promise<void> {
    if (this.evaluationInterval) clearInterval(this.evaluationInterval);
    for (const job of this.cronJobs.values()) {
      job.stop();
    }
    this.cronJobs.clear();
  }
}
```

**Step 4: Register in agent wiring**

In `src/core/agent-instance.ts` wireAgentInstance:

```typescript
case "directives":
  await pluginHost.register(new DirectivesPlugin(), {});
  break;
```

**Step 5: Run all tests**

Run: `cd /home/guyfawkes/nixclaw && npx vitest run`
Expected: All tests pass.

**Step 6: Commit**

```bash
git add src/tools/directives/ src/core/agent-instance.ts
git commit -m "feat: add standing directives plugin with cron and interval triggers"
```

---

## Task 5: mcp-calendar server

Create a FastMCP server for Google Calendar management.

**Files:**
- Create: `mcp-servers/calendar/server.py`
- Create: `mcp-servers/calendar/test_server.py`
- Create: `mcp-servers/calendar/pyproject.toml`

**Step 1: Create pyproject.toml**

```toml
[project]
name = "clawnix-mcp-calendar"
version = "0.1.0"
description = "ClawNix MCP server for Google Calendar"
requires-python = ">=3.11"
dependencies = [
    "fastmcp>=2.0.0",
    "google-api-python-client>=2.100.0",
    "google-auth-oauthlib>=1.0.0",
    "google-auth-httplib2>=0.2.0",
]

[project.optional-dependencies]
dev = ["pytest>=8.0.0"]

[project.scripts]
clawnix-mcp-calendar = "server:main"

[build-system]
requires = ["setuptools>=68.0"]
build-backend = "setuptools.backends._legacy:_Backend"
```

**Step 2: Write the tests**

```python
# mcp-servers/calendar/test_server.py
import json
import os
import pytest
from unittest.mock import patch, MagicMock
from datetime import datetime, timedelta
from server import list_events, create_event, find_free_time

# FastMCP 2.x wraps @mcp.tool functions
_list_events = list_events.fn
_create_event = create_event.fn
_find_free_time = find_free_time.fn


@pytest.fixture
def mock_creds(tmp_path, monkeypatch):
    creds_file = tmp_path / "creds.json"
    creds_file.write_text('{"installed": {"client_id": "test"}}')
    token_file = tmp_path / "token.json"
    monkeypatch.setenv("CLAWNIX_GOOGLE_CREDENTIALS_FILE", str(creds_file))
    monkeypatch.setenv("CLAWNIX_GOOGLE_TOKEN_FILE", str(token_file))


def test_list_events_returns_summary(mock_creds):
    mock_service = MagicMock()
    mock_events = {
        "items": [
            {
                "summary": "Team standup",
                "start": {"dateTime": "2026-02-23T09:00:00+01:00"},
                "end": {"dateTime": "2026-02-23T09:30:00+01:00"},
                "id": "event1",
            },
            {
                "summary": "Lunch",
                "start": {"dateTime": "2026-02-23T12:00:00+01:00"},
                "end": {"dateTime": "2026-02-23T13:00:00+01:00"},
                "id": "event2",
            },
        ]
    }
    mock_service.events.return_value.list.return_value.execute.return_value = mock_events

    with patch("server._get_calendar_service", return_value=mock_service):
        result = _list_events(days=1)

    assert "Team standup" in result
    assert "Lunch" in result


def test_create_event_returns_link(mock_creds):
    mock_service = MagicMock()
    mock_service.events.return_value.insert.return_value.execute.return_value = {
        "id": "new-event-1",
        "htmlLink": "https://calendar.google.com/event?eid=123",
        "summary": "New meeting",
    }

    with patch("server._get_calendar_service", return_value=mock_service):
        result = _create_event(
            summary="New meeting",
            start="2026-02-24T10:00:00",
            end="2026-02-24T11:00:00",
        )

    parsed = json.loads(result)
    assert parsed["status"] == "created"
    assert "htmlLink" in parsed


def test_find_free_time_returns_slots(mock_creds):
    mock_service = MagicMock()
    # Return some events to calculate free time around
    mock_events = {
        "items": [
            {
                "summary": "Existing meeting",
                "start": {"dateTime": "2026-02-24T10:00:00+01:00"},
                "end": {"dateTime": "2026-02-24T11:00:00+01:00"},
            },
        ]
    }
    mock_service.events.return_value.list.return_value.execute.return_value = mock_events

    with patch("server._get_calendar_service", return_value=mock_service):
        result = _find_free_time(date="2026-02-24", duration_minutes=30)

    assert "free" in result.lower() or "available" in result.lower()
```

**Step 3: Run tests to verify they fail**

Run: `cd /home/guyfawkes/nixclaw/mcp-servers/calendar && nix shell --impure --expr 'let pkgs = import <nixpkgs> {}; in pkgs.python3.withPackages (ps: with ps; [ fastmcp google-api-python-client google-auth-oauthlib google-auth-httplib2 pytest ])' --command python -m pytest test_server.py -v`
Expected: FAIL — module `server` not found.

**Step 4: Implement the server**

```python
# mcp-servers/calendar/server.py
"""ClawNix MCP server for Google Calendar."""

import json
import os
from datetime import datetime, timedelta

from fastmcp import FastMCP
from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import InstalledAppFlow
from google.auth.transport.requests import Request
from googleapiclient.discovery import build

mcp = FastMCP(
    name="clawnix-mcp-calendar",
    instructions="Manage Google Calendar events. List, create, and find free time.",
)

SCOPES = ["https://www.googleapis.com/auth/calendar"]


def _get_calendar_service():
    creds_file = os.environ.get("CLAWNIX_GOOGLE_CREDENTIALS_FILE", "")
    token_file = os.environ.get("CLAWNIX_GOOGLE_TOKEN_FILE", "/tmp/clawnix-calendar-token.json")

    creds = None
    if os.path.exists(token_file):
        creds = Credentials.from_authorized_user_file(token_file, SCOPES)

    if not creds or not creds.valid:
        if creds and creds.expired and creds.refresh_token:
            creds.refresh(Request())
        else:
            if not creds_file or not os.path.exists(creds_file):
                raise RuntimeError(
                    "No Google credentials found. Set CLAWNIX_GOOGLE_CREDENTIALS_FILE "
                    "to path of OAuth client credentials JSON."
                )
            flow = InstalledAppFlow.from_client_secrets_file(creds_file, SCOPES)
            creds = flow.run_local_server(port=0)

        with open(token_file, "w") as f:
            f.write(creds.to_json())

    return build("calendar", "v3", credentials=creds)


@mcp.tool
def list_events(days: int = 7, calendar_id: str = "primary") -> str:
    """List upcoming calendar events for the next N days."""
    service = _get_calendar_service()
    now = datetime.utcnow()
    time_min = now.isoformat() + "Z"
    time_max = (now + timedelta(days=days)).isoformat() + "Z"

    result = service.events().list(
        calendarId=calendar_id,
        timeMin=time_min,
        timeMax=time_max,
        singleEvents=True,
        orderBy="startTime",
    ).execute()

    events = result.get("items", [])
    if not events:
        return f"No events in the next {days} days."

    lines = []
    for event in events:
        start = event["start"].get("dateTime", event["start"].get("date"))
        end = event["end"].get("dateTime", event["end"].get("date"))
        summary = event.get("summary", "Untitled")
        lines.append(f"- {start} → {end}: {summary}")

    return "\n".join(lines)


@mcp.tool
def create_event(
    summary: str,
    start: str,
    end: str,
    description: str = "",
    calendar_id: str = "primary",
) -> str:
    """Create a calendar event.

    Start and end should be ISO 8601 datetime strings (e.g. '2026-02-24T10:00:00').
    """
    service = _get_calendar_service()
    event_body = {
        "summary": summary,
        "start": {"dateTime": start, "timeZone": "Europe/Rome"},
        "end": {"dateTime": end, "timeZone": "Europe/Rome"},
    }
    if description:
        event_body["description"] = description

    event = service.events().insert(calendarId=calendar_id, body=event_body).execute()

    return json.dumps({
        "status": "created",
        "id": event.get("id"),
        "htmlLink": event.get("htmlLink"),
        "summary": summary,
    })


@mcp.tool
def find_free_time(date: str, duration_minutes: int = 60, calendar_id: str = "primary") -> str:
    """Find available time slots on a given date.

    Date should be YYYY-MM-DD format. Returns free slots of at least duration_minutes.
    """
    service = _get_calendar_service()
    day_start = datetime.fromisoformat(f"{date}T08:00:00")
    day_end = datetime.fromisoformat(f"{date}T18:00:00")

    result = service.events().list(
        calendarId=calendar_id,
        timeMin=day_start.isoformat() + "Z",
        timeMax=day_end.isoformat() + "Z",
        singleEvents=True,
        orderBy="startTime",
    ).execute()

    events = result.get("items", [])

    # Build list of busy periods
    busy = []
    for event in events:
        start_str = event["start"].get("dateTime")
        end_str = event["end"].get("dateTime")
        if start_str and end_str:
            busy.append((
                datetime.fromisoformat(start_str.replace("Z", "+00:00")),
                datetime.fromisoformat(end_str.replace("Z", "+00:00")),
            ))

    busy.sort(key=lambda x: x[0])

    # Find free slots
    free_slots = []
    current = day_start
    for b_start, b_end in busy:
        b_start_naive = b_start.replace(tzinfo=None)
        b_end_naive = b_end.replace(tzinfo=None)
        if (b_start_naive - current).total_seconds() >= duration_minutes * 60:
            free_slots.append(f"  {current.strftime('%H:%M')} → {b_start_naive.strftime('%H:%M')}")
        current = max(current, b_end_naive)

    if (day_end - current).total_seconds() >= duration_minutes * 60:
        free_slots.append(f"  {current.strftime('%H:%M')} → {day_end.strftime('%H:%M')}")

    if not free_slots:
        return f"No free slots of {duration_minutes}+ minutes on {date}."

    return f"Available slots on {date} ({duration_minutes}+ min):\n" + "\n".join(free_slots)


def main():
    mcp.run()


if __name__ == "__main__":
    main()
```

**Step 5: Run tests**

Run the nix shell command from Step 3.
Expected: All 3 tests pass.

**Step 6: Commit**

```bash
cd /home/guyfawkes/nixclaw && git add mcp-servers/calendar/
git commit -m "feat: add mcp-calendar server for Google Calendar integration"
```

---

## Task 6: Nix packaging for mcp-calendar

**Files:**
- Create: `nix/mcp-calendar.nix`
- Modify: `flake.nix`

**Step 1: Create nix/mcp-calendar.nix**

```nix
{ pkgs }:
let
  pythonEnv = pkgs.python3.withPackages (ps: with ps; [
    fastmcp
    google-api-python-client
    google-auth-oauthlib
    google-auth-httplib2
  ]);
in
pkgs.writeShellScriptBin "clawnix-mcp-calendar" ''
  exec ${pythonEnv}/bin/python ${../mcp-servers/calendar/server.py} "$@"
''
```

**Step 2: Update flake.nix**

Add `mcp-calendar` to the packages output:

```nix
mcp-calendar = import ./nix/mcp-calendar.nix { inherit pkgs; };
```

**Step 3: Verify**

Run: `cd /home/guyfawkes/nixclaw && nix flake check`
Expected: No errors.

Run: `nix build .#mcp-calendar --no-link --print-out-paths`
Expected: Build succeeds.

**Step 4: Commit**

```bash
git add nix/mcp-calendar.nix flake.nix
git commit -m "feat: add Nix packaging for mcp-calendar server"
```

---

## Task 7: Mount allowlists in config and NixOS module

Add per-agent filesystem access controls.

**Files:**
- Modify: `src/core/config.ts`
- Modify: `nix/module.nix`
- Modify: `nix/server-example.nix`

**Step 1: Add filesystem config to AgentInstanceConfig**

In `src/core/config.ts`:

```typescript
export interface AgentInstanceConfig {
  // ... existing fields ...
  filesystem?: {
    readPaths?: string[];
    writePaths?: string[];
    blockedPatterns?: string[];
  };
}
```

**Step 2: Add filesystem options to NixOS module agent submodule**

In `nix/module.nix`, add to `agentModule.options`:

```nix
filesystem = {
  readPaths = lib.mkOption {
    type = lib.types.listOf lib.types.str;
    default = [ "/tmp" "/var/log" "/etc/nixos" ];
    description = "Paths the agent can read (passed to observe plugin)";
  };
  writePaths = lib.mkOption {
    type = lib.types.listOf lib.types.str;
    default = [ ];
    description = "Additional paths the agent can write to (added to systemd ReadWritePaths)";
  };
  blockedPatterns = lib.mkOption {
    type = lib.types.listOf lib.types.str;
    default = [ ".ssh" ".gnupg" "*.key" "*.pem" ];
    description = "File patterns the agent cannot access";
  };
};
```

**Step 3: Wire filesystem.readPaths into the observe config in agentConfigJSON**

In `nix/module.nix`, update `agentConfigJSON`:

```nix
tools = {
  observe = {
    allowedReadPaths = agentCfg.filesystem.readPaths;
    blockedPatterns = agentCfg.filesystem.blockedPatterns;
  };
};
```

**Step 4: Add writePaths to systemd ReadWritePaths**

In `nix/module.nix`, update serviceConfig:

```nix
ReadWritePaths = [ cfg.stateDir "${cfg.stateDir}/${name}" agentCfg.workspaceDir ]
  ++ agentCfg.filesystem.writePaths;
```

**Step 5: Update server example with filesystem config**

In `nix/server-example.nix`:

```nix
agents.personal = {
  # ... existing ...
  filesystem = {
    readPaths = [ "/tmp" "/var/log" "/etc/nixos" ];
    writePaths = [ "/var/lib/clawnix/documents" ];
    blockedPatterns = [ ".ssh" ".gnupg" "*.key" "*.pem" ];
  };
};
```

**Step 6: Verify**

Run: `cd /home/guyfawkes/nixclaw && nix flake check`
Expected: No errors.

**Step 7: Commit**

```bash
git add src/core/config.ts nix/module.nix nix/server-example.nix
git commit -m "feat: add per-agent filesystem mount allowlists"
```

---

## Task 8: Multi-agent server example with personality files

Update the server example with 4 specialized agents and create workspace personality files.

**Files:**
- Modify: `nix/server-example.nix`
- Create: `examples/workspaces/personal/IDENTITY.md`
- Create: `examples/workspaces/devops/IDENTITY.md`
- Create: `examples/workspaces/researcher/IDENTITY.md`
- Create: `examples/workspaces/support/IDENTITY.md`

**Step 1: Update server example with 4 agents**

In `nix/server-example.nix`, add devops, researcher, support agents alongside the existing personal:

```nix
agents.devops = {
  description = "server health, NixOS, deployments, CI/CD, infrastructure";
  ai = {
    model = "claude-sonnet-4-6";
    apiKeyFile = "/run/secrets/anthropic-api-key";
  };
  channels.telegram.enable = true;
  channels.webui.enable = true;
  tools = [ "nixos" "observe" "scheduler" "heartbeat" "memory" "directives" ];
  workspaceDir = "/var/lib/clawnix/devops";
  filesystem.readPaths = [ "/tmp" "/var/log" "/etc/nixos" "/nix/var/nix" ];
};

agents.researcher = {
  description = "web research, article summaries, topic monitoring";
  ai = {
    model = "claude-sonnet-4-6";
    apiKeyFile = "/run/secrets/anthropic-api-key";
  };
  channels.telegram.enable = true;
  tools = [ "scheduler" "heartbeat" "memory" "directives" ];
  workspaceDir = "/var/lib/clawnix/researcher";
};

agents.support = {
  description = "email drafts, client communication, documents (PPTX/XLSX/PDF)";
  ai = {
    model = "claude-sonnet-4-6";
    apiKeyFile = "/run/secrets/anthropic-api-key";
  };
  channels.telegram.enable = true;
  tools = [ "scheduler" "memory" "directives" ];
  workspaceDir = "/var/lib/clawnix/support";
  security.toolPolicies = [
    { tool = "list_emails"; effect = "allow"; }
    { tool = "read_email"; effect = "allow"; }
    { tool = "draft_reply"; effect = "allow"; }
    { tool = "send_email"; effect = "approve"; }
    { tool = "create_presentation"; effect = "allow"; }
    { tool = "create_spreadsheet"; effect = "allow"; }
    { tool = "create_pdf"; effect = "allow"; }
  ];
};
```

Also update agents.personal to include `"memory"` and `"directives"` in tools and `"calendar"` in MCP servers.

**Step 2: Create personality files**

```markdown
<!-- examples/workspaces/personal/IDENTITY.md -->
You are the Personal agent for ClawNix. You handle calendar management, reminders, daily tasks, and general questions. You are the user's primary point of contact — friendly, proactive, and concise.
```

```markdown
<!-- examples/workspaces/devops/IDENTITY.md -->
You are the DevOps agent for ClawNix. You monitor server health, manage NixOS configuration, handle deployments, and respond to infrastructure alerts. Be precise and systematic.
```

```markdown
<!-- examples/workspaces/researcher/IDENTITY.md -->
You are the Research agent for ClawNix. You search the web, summarize articles, monitor topics of interest, and compile briefings. Be thorough but concise. Cite sources.
```

```markdown
<!-- examples/workspaces/support/IDENTITY.md -->
You are the Support agent for ClawNix. You draft email replies, prepare presentations, create spreadsheets and PDFs, and handle client communication. Always draft before sending — never send without approval.
```

**Step 3: Verify**

Run: `cd /home/guyfawkes/nixclaw && nix flake check`
Expected: No errors.

**Step 4: Commit**

```bash
git add nix/server-example.nix examples/
git commit -m "feat: add 4-agent server example with personality files"
```

---

## Task 9: Update README

**Files:**
- Modify: `README.md`

**Step 1: Add sections for new features**

After the MCP tool servers section, add:

```markdown
## Per-Agent Memory

Each agent has persistent memory via `memory/MEMORY.md` in its workspace directory. Agents can read and write their own memory using `clawnix_memory_read` and `clawnix_memory_write` tools. A shared `GLOBAL.md` in the state directory is read by all agents.

## Standing Directives

Agents support standing directives — persistent "when X happens, do Y" instructions:

- `cron:EXPRESSION` — triggers on cron schedule (e.g. `cron:0 9 * * *` for daily at 9am)
- `interval:MINUTES` — triggers every N minutes

Directives persist across restarts and are managed with `clawnix_directive_create`, `clawnix_directive_list`, and `clawnix_directive_remove` tools.

## Multi-Agent Setup

Split responsibilities across specialized agents. Each agent has its own tools, MCP servers, memory, and tool policies. The natural language router dispatches Telegram messages to the correct agent.

See `examples/workspaces/` for personality file templates and `nix/server-example.nix` for a 4-agent configuration (personal, devops, researcher, support).
```

Add `mcp-calendar` to the MCP tool servers table.

Update the project structure to include `examples/`.

**Step 2: Run full test suite**

Run: `cd /home/guyfawkes/nixclaw && npx vitest run`
Expected: All tests pass.

**Step 3: Commit**

```bash
git add README.md
git commit -m "docs: add memory, directives, multi-agent, and calendar sections to README"
```

---

## Summary

| Task | Description | New files | Modified files |
|------|-------------|-----------|----------------|
| 1 | Complete multi-agent wiring | — | agent.ts, agent-instance.ts, index.ts |
| 2 | Per-agent memory + GLOBAL.md | memory/index.ts, test | personality.ts, agent.ts, agent-instance.ts |
| 3 | Persistent scheduler | — | scheduler/index.ts, test |
| 4 | Standing directives | directives/index.ts, test | agent-instance.ts |
| 5 | mcp-calendar | server.py, test, pyproject.toml | — |
| 6 | Nix packaging for calendar | mcp-calendar.nix | flake.nix |
| 7 | Mount allowlists | — | config.ts, module.nix, server-example.nix |
| 8 | Multi-agent server example | 4 IDENTITY.md files | server-example.nix |
| 9 | README update | — | README.md |

9 tasks. Multi-agent wiring first (foundation), then memory + scheduler + directives (features), then calendar + packaging + config + docs.
