# Phase 6: Polish and Harden — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add inter-agent communication, Telegram inline buttons, morning briefings, NixOS auto-update pipeline, systemd watchdog, and headless browser automation.

**Architecture:** Phase 6 hardens the multi-agent platform. The EventBus (broadcast-only) gets a point-to-point `AgentBroker` layer so agents can delegate tasks to each other. Telegram upgrades from text `/allow`/`/deny` to grammY InlineKeyboard with callback queries. The existing Directives plugin powers morning briefings (cron triggers). NixOS gains update tools that call `nix flake update` + `nixos-rebuild` (with sudo, requiring NOPASSWD config). Each systemd agent service gets `WatchdogSec` + a plugin that calls `sd_notify`. mcp-playwright follows the FastMCP pattern.

**Tech Stack:** TypeScript, grammY (InlineKeyboard + callbackQuery), cron (directives), child_process (NixOS commands), sd-notify (systemd watchdog), Python + FastMCP + Playwright (browser automation), Nix (module + packaging)

---

### Task 1: Agent communication broker — types and broker class

**Files:**
- Create: `src/core/agent-broker.ts`
- Test: `src/core/agent-broker.test.ts`

**Context:** The EventBus (src/core/event-bus.ts) is broadcast-only — `emit` sends to all listeners. For inter-agent delegation we need point-to-point messaging. The AgentBroker holds a registry of named agents, lets one agent send a request to another, and emits the response back when the target finishes.

**Step 1: Write the failing test**

```typescript
// src/core/agent-broker.test.ts
import { describe, it, expect, vi } from "vitest";
import { AgentBroker } from "./agent-broker.js";
import type { DelegationRequest, DelegationResponse } from "./agent-broker.js";

describe("AgentBroker", () => {
  it("registers agents and routes delegation requests", async () => {
    const broker = new AgentBroker();
    const handler = vi.fn().mockResolvedValue("done researching");

    broker.registerAgent("researcher", handler);

    const result = await broker.delegate({
      from: "personal",
      to: "researcher",
      task: "find articles about NixOS security",
      context: "user asked about hardening",
    });

    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({
        from: "personal",
        task: "find articles about NixOS security",
      }),
    );
    expect(result.status).toBe("completed");
    expect(result.result).toBe("done researching");
  });

  it("returns error for unknown target agent", async () => {
    const broker = new AgentBroker();
    const result = await broker.delegate({
      from: "personal",
      to: "nonexistent",
      task: "something",
    });
    expect(result.status).toBe("error");
    expect(result.result).toContain("nonexistent");
  });

  it("returns error when handler throws", async () => {
    const broker = new AgentBroker();
    broker.registerAgent("broken", vi.fn().mockRejectedValue(new Error("boom")));

    const result = await broker.delegate({
      from: "personal",
      to: "broken",
      task: "do something",
    });
    expect(result.status).toBe("error");
    expect(result.result).toContain("boom");
  });

  it("lists registered agent names", () => {
    const broker = new AgentBroker();
    broker.registerAgent("a", vi.fn());
    broker.registerAgent("b", vi.fn());
    expect(broker.listAgents()).toEqual(["a", "b"]);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/core/agent-broker.test.ts`
Expected: FAIL — cannot resolve `./agent-broker.js`

**Step 3: Write minimal implementation**

```typescript
// src/core/agent-broker.ts
export interface DelegationRequest {
  from: string;
  to: string;
  task: string;
  context?: string;
}

export interface DelegationResponse {
  from: string;
  to: string;
  status: "completed" | "error";
  result: string;
}

export type DelegationHandler = (request: DelegationRequest) => Promise<string>;

export class AgentBroker {
  private agents = new Map<string, DelegationHandler>();

  registerAgent(name: string, handler: DelegationHandler): void {
    this.agents.set(name, handler);
  }

  listAgents(): string[] {
    return [...this.agents.keys()];
  }

  async delegate(request: DelegationRequest): Promise<DelegationResponse> {
    const handler = this.agents.get(request.to);
    if (!handler) {
      return {
        from: request.to,
        to: request.from,
        status: "error",
        result: `Agent "${request.to}" not found. Available: ${this.listAgents().join(", ")}`,
      };
    }
    try {
      const result = await handler(request);
      return { from: request.to, to: request.from, status: "completed", result };
    } catch (err) {
      return {
        from: request.to,
        to: request.from,
        status: "error",
        result: `Delegation to "${request.to}" failed: ${(err as Error).message}`,
      };
    }
  }
}
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run src/core/agent-broker.test.ts`
Expected: PASS (4 tests)

**Step 5: Commit**

```bash
git add src/core/agent-broker.ts src/core/agent-broker.test.ts
git commit -m "feat: add AgentBroker for point-to-point inter-agent delegation"
```

---

### Task 2: Delegation tools — clawnix_delegate and clawnix_list_agents

**Files:**
- Create: `src/tools/delegation/index.ts`
- Create: `src/tools/delegation/index.test.ts`

**Context:** Each agent gets two new tools: `clawnix_delegate` (send a task to another agent and wait for the result) and `clawnix_list_agents` (see available agents). The plugin receives the AgentBroker and the current agent name via config.

**Step 1: Write the failing test**

```typescript
// src/tools/delegation/index.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { DelegationPlugin } from "./index.js";
import { EventBus } from "../../core/event-bus.js";
import { StateStore } from "../../core/state.js";
import { AgentBroker } from "../../core/agent-broker.js";
import type { Tool } from "../../core/types.js";

describe("DelegationPlugin", () => {
  let plugin: DelegationPlugin;
  let broker: AgentBroker;
  let tools: Tool[];

  beforeEach(async () => {
    plugin = new DelegationPlugin();
    broker = new AgentBroker();
    tools = [];

    broker.registerAgent("researcher", async (req) => `Found info about: ${req.task}`);
    broker.registerAgent("personal", async () => "ok");

    const eventBus = new EventBus();
    const state = new StateStore(":memory:");
    await plugin.init({
      eventBus,
      state,
      config: { agentName: "personal", broker },
      registerTool: (t: Tool) => tools.push(t),
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    });
  });

  it("registers delegate and list_agents tools", () => {
    expect(tools.map((t) => t.name)).toEqual(["clawnix_delegate", "clawnix_list_agents"]);
  });

  it("clawnix_delegate sends task to target agent", async () => {
    const delegate = tools.find((t) => t.name === "clawnix_delegate")!;
    const result = await delegate.run({ targetAgent: "researcher", task: "find NixOS articles" });
    const parsed = JSON.parse(result);
    expect(parsed.status).toBe("completed");
    expect(parsed.result).toContain("NixOS articles");
  });

  it("clawnix_list_agents returns agent names", async () => {
    const list = tools.find((t) => t.name === "clawnix_list_agents")!;
    const result = await list.run({});
    expect(result).toContain("researcher");
    expect(result).toContain("personal");
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/tools/delegation/index.test.ts`
Expected: FAIL — cannot resolve `./index.js`

**Step 3: Write minimal implementation**

```typescript
// src/tools/delegation/index.ts
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
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run src/tools/delegation/index.test.ts`
Expected: PASS (3 tests)

**Step 5: Commit**

```bash
git add src/tools/delegation/index.ts src/tools/delegation/index.test.ts
git commit -m "feat: add delegation plugin with delegate and list_agents tools"
```

---

### Task 3: Wire AgentBroker into multi-agent startup

**Files:**
- Modify: `src/core/agent-instance.ts` (add "delegation" to the tool switch, accept broker in config)
- Modify: `src/index.ts:46-103` (create broker, register delegation handlers, pass to wireAgentInstance)
- Modify: `src/core/config.ts` (no change needed — `tools` is already `string[]`)
- Modify: `src/core/agent-instance.test.ts` (add delegation wiring test)

**Context:** The AgentBroker is created once in `startMultiAgent()`, each agent registers a delegation handler that emits a `message:incoming` on its EventBus, and the broker is passed to `wireAgentInstance` for the DelegationPlugin.

**Step 1: Write the failing test**

Add to `src/core/agent-instance.test.ts`:
```typescript
it("wires delegation plugin when tools include delegation", async () => {
  // ... setup AgentBroker, call wireAgentInstance with tools: ["delegation"]
  // verify the delegation tools are registered
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/core/agent-instance.test.ts`
Expected: FAIL — no "delegation" case in switch

**Step 3: Implement wiring**

In `src/core/agent-instance.ts`, add import for DelegationPlugin and add case:
```typescript
import { DelegationPlugin } from "../tools/delegation/index.js";

// Inside the switch in wireAgentInstance:
case "delegation":
  await pluginHost.register(new DelegationPlugin(), {
    agentName: instance.name,
    broker: agentConfig._broker,
  });
  break;
```

In `src/index.ts` `startMultiAgent()`, create the broker before the agent loop and wire it:
```typescript
import { AgentBroker } from "./core/agent-broker.js";

// Inside startMultiAgent, before the for-loop:
const broker = new AgentBroker();

// After wiredInstance is created, register handler:
broker.registerAgent(name, async (request) => {
  const msg: ClawNixMessage = {
    id: randomUUID(),
    channel: "delegation",
    sender: request.from,
    text: `[Delegated from ${request.from}] ${request.task}${request.context ? `\nContext: ${request.context}` : ""}`,
    timestamp: new Date(),
  };
  instance.eventBus.emit("message:incoming", msg);
  return `Task delegated to ${name}. The agent will process it asynchronously.`;
});

// Pass broker in agentConfig before wireAgentInstance:
(agentConfig as any)._broker = broker;
```

**Step 4: Run tests**

Run: `npx vitest run src/core/agent-instance.test.ts src/index-multi.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/core/agent-instance.ts src/index.ts src/core/agent-instance.test.ts
git commit -m "feat: wire AgentBroker into multi-agent startup with delegation tools"
```

---

### Task 4: Telegram inline buttons for approvals

**Files:**
- Modify: `src/channels/telegram/index.ts:184-198` (replace text approval with InlineKeyboard)
- Modify: `src/channels/telegram/index.ts` (add `bot.on("callback_query:data")` handler)
- Test: `src/channels/telegram/approval.test.ts` (keep existing + add callback data parser test)
- Modify: `src/channels/telegram/approval.ts` (add parseCallbackData function)

**Context:** Currently (line 191), approval requests send plain text with `/allow ID` and `/deny ID` instructions. Users must type the command. Upgrade to InlineKeyboard buttons using grammY. When tapped, a `callback_query:data` event fires. The callback data format is `approve:ID` or `deny:ID`.

**Step 1: Write the failing test**

Add to `src/channels/telegram/approval.test.ts`:
```typescript
import { parseCallbackData } from "./approval.js";

describe("parseCallbackData", () => {
  it("parses approve callback", () => {
    expect(parseCallbackData("approve:abc123")).toEqual({ decision: "allow", id: "abc123" });
  });
  it("parses deny callback", () => {
    expect(parseCallbackData("deny:abc123")).toEqual({ decision: "deny", id: "abc123" });
  });
  it("returns null for unknown format", () => {
    expect(parseCallbackData("something:else")).toBeNull();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/channels/telegram/approval.test.ts`
Expected: FAIL — parseCallbackData not exported

**Step 3: Add parseCallbackData**

In `src/channels/telegram/approval.ts`:
```typescript
export function parseApprovalCommand(text: string): { decision: "allow" | "deny"; id: string } | null {
  const match = text.match(/^\/(allow|deny)\s+(\S+)/);
  if (!match) return null;
  return { decision: match[1] as "allow" | "deny", id: match[2] };
}

export function parseCallbackData(data: string): { decision: "allow" | "deny"; id: string } | null {
  const match = data.match(/^(approve|deny):(.+)$/);
  if (!match) return null;
  return { decision: match[1] === "approve" ? "allow" : "deny", id: match[2] };
}
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run src/channels/telegram/approval.test.ts`
Expected: PASS

**Step 5: Update Telegram channel to use InlineKeyboard**

In `src/channels/telegram/index.ts`, replace the `approval:request` handler (lines 185-198) with:

```typescript
import { InlineKeyboard } from "grammy";
import { parseCallbackData } from "./approval.js";

// Replace the approval:request listener:
const approvalCleanup = ctx.eventBus.on("approval:request", async (payload: unknown) => {
  const req = payload as { id: string; tool: string; input: string; session: string };
  if (!req) return;
  const notifyUser = allowedUsers[0];
  if (!notifyUser || !this.bot) return;

  const message = `🔐 Approval Request [${req.id}]\n\nTool: ${req.tool}\nInput: ${req.input}\nSession: ${req.session}`;
  const keyboard = new InlineKeyboard()
    .text("✅ Allow", `approve:${req.id}`)
    .text("❌ Deny", `deny:${req.id}`);

  try {
    await this.bot.api.sendMessage(Number(notifyUser), message, {
      reply_markup: keyboard,
    });
  } catch (err) {
    ctx.logger.error("Failed to send approval notification:", err);
  }
});
this.cleanups.push(approvalCleanup);

// Add callback_query handler (after the bot.on("message:text") block):
this.bot.on("callback_query:data", async (gramCtx) => {
  const userId = String(gramCtx.from.id);
  if (!pairing.isAuthorized(userId)) {
    await gramCtx.answerCallbackQuery({ text: "Not authorized" });
    return;
  }

  const result = parseCallbackData(gramCtx.callbackQuery.data);
  if (result) {
    ctx.eventBus.emit("approval:decide", result);
    await gramCtx.answerCallbackQuery({
      text: `${result.decision === "allow" ? "Approved" : "Denied"}`,
    });
    // Edit the message to reflect the decision
    try {
      await gramCtx.editMessageText(
        `${gramCtx.callbackQuery.message?.text}\n\n✓ ${result.decision === "allow" ? "Allowed" : "Denied"} by user`,
      );
    } catch { /* message may have been deleted */ }
  }
});
```

**Step 6: Run all tests**

Run: `npx vitest run src/channels/telegram/`
Expected: PASS

**Step 7: Commit**

```bash
git add src/channels/telegram/approval.ts src/channels/telegram/approval.test.ts src/channels/telegram/index.ts
git commit -m "feat: upgrade Telegram approvals to inline buttons with callback queries"
```

---

### Task 5: Morning briefings via directives

**Files:**
- Modify: `examples/workspaces/personal/IDENTITY.md`
- Create: `examples/workspaces/personal/BRIEFING.md` (template for morning briefing content)

**Context:** Morning briefings require no new code. The existing Directives plugin (src/tools/directives/index.ts) already supports `cron:` triggers that fire `message:incoming` events. The personal agent creates a standing directive like `cron:0 9 * * *` with action "Generate a morning briefing: check today's calendar, list pending tasks, summarize overnight emails, report weather."

The implementation here is to provide a documented example: a briefing template and updated IDENTITY.md that instructs the agent to create the directive on first run.

**Step 1: Update personal identity to mention briefings**

```markdown
<!-- examples/workspaces/personal/IDENTITY.md -->
You are the Personal agent for ClawNix. You handle calendar management, reminders, daily tasks, and general questions. You are the user's primary point of contact — friendly, proactive, and concise.

On first interaction, if no morning briefing directive exists, create one:
- Trigger: cron:0 9 * * * (daily at 9am)
- Action: Generate a morning briefing covering today's calendar events, pending tasks, and any overnight notifications.
```

**Step 2: Create briefing template**

```markdown
<!-- examples/workspaces/personal/BRIEFING.md -->
# Morning Briefing Template

When generating a morning briefing, include:

1. **Calendar** — Today's events from mcp-calendar (list_events for today)
2. **Tasks** — Pending scheduled tasks (clawnix_list_scheduled)
3. **Directives** — Active standing directives (clawnix_directive_list)
4. **System** — Server uptime and status (clawnix_system_status)

Keep it concise. Use bullet points. Prioritize actionable items.
```

**Step 3: Commit**

```bash
git add examples/workspaces/personal/IDENTITY.md examples/workspaces/personal/BRIEFING.md
git commit -m "feat: add morning briefing directive template for personal agent"
```

---

### Task 6: NixOS auto-update commands

**Files:**
- Modify: `src/tools/nixos/commands.ts` (add flakeUpdate, systemRebuild, systemRollback functions)
- Create: `src/tools/nixos/commands.test.ts` (test command construction — mock execFile)
- Modify: `src/tools/nixos/index.ts` (register 3 new tools: clawnix_flake_update, clawnix_system_rebuild, clawnix_system_rollback)

**Context:** The existing commands.ts has a `runCommand` helper that wraps `execFile`. The new commands need longer timeouts (rebuild can take minutes). `nixos-rebuild switch` requires root — the agent process (DynamicUser) must use `sudo`. Operators configure NOPASSWD for the clawnix user in their NixOS config. Rollback uses `nixos-rebuild switch --rollback`.

**Step 1: Write the failing test**

```typescript
// src/tools/nixos/commands.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

// We'll test the command construction, not actual execution
describe("NixOS update commands", () => {
  it("flakeUpdate calls nix flake update with correct path", async () => {
    const { flakeUpdate } = await import("./commands.js");
    // This will actually try to run — we test it doesn't throw with a valid shape
    const result = await flakeUpdate("/nonexistent/path");
    expect(result).toContain("Error");  // Path doesn't exist, but function runs
  });

  it("systemRebuild calls sudo nixos-rebuild switch", async () => {
    const { systemRebuild } = await import("./commands.js");
    const result = await systemRebuild("/nonexistent/path");
    expect(result).toContain("Error");  // No sudo, but function runs
  });

  it("systemRollback calls sudo nixos-rebuild switch --rollback", async () => {
    const { systemRollback } = await import("./commands.js");
    const result = await systemRollback();
    expect(result).toContain("Error");  // No sudo, but function runs
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/tools/nixos/commands.test.ts`
Expected: FAIL — flakeUpdate is not exported

**Step 3: Add update commands to commands.ts**

Append to `src/tools/nixos/commands.ts`:
```typescript
export async function flakeUpdate(flakePath: string): Promise<string> {
  return runCommand("nix", ["flake", "update", "--flake", flakePath], 120_000);
}

export async function systemRebuild(flakePath: string): Promise<string> {
  return runCommand("sudo", ["nixos-rebuild", "switch", "--flake", flakePath], 300_000);
}

export async function systemRollback(): Promise<string> {
  return runCommand("sudo", ["nixos-rebuild", "switch", "--rollback"], 300_000);
}
```

Also update `runCommand` to accept an optional timeout parameter:
```typescript
export async function runCommand(cmd: string, args: string[], timeout = 30000): Promise<string> {
  try {
    const { stdout, stderr } = await exec(cmd, args, { timeout });
    return stdout + (stderr ? `\nSTDERR: ${stderr}` : "");
  } catch (err: unknown) {
    const e = err as { stdout?: string; stderr?: string; message: string };
    return `Error: ${e.message}\n${e.stdout ?? ""}\n${e.stderr ?? ""}`.trim();
  }
}
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run src/tools/nixos/commands.test.ts`
Expected: PASS

**Step 5: Register new tools in nixos/index.ts**

Add to `src/tools/nixos/index.ts` after the existing tool registrations:
```typescript
import { flakeUpdate, systemRebuild, systemRollback } from "./commands.js";

// After the existing 7 tools:
ctx.registerTool({
  name: "clawnix_flake_update",
  description: "Update flake.lock to pull the latest nixpkgs and other inputs. Does not rebuild the system.",
  inputSchema: z.object({}),
  run: async () => flakeUpdate(flakePath),
});

ctx.registerTool({
  name: "clawnix_system_rebuild",
  description:
    "Rebuild and switch to the new NixOS configuration. Requires sudo NOPASSWD for nixos-rebuild. " +
    "Run clawnix_flake_update first to get new packages, then this to apply.",
  inputSchema: z.object({}),
  run: async () => systemRebuild(flakePath),
});

ctx.registerTool({
  name: "clawnix_system_rollback",
  description:
    "Roll back to the previous NixOS generation. Use if a rebuild causes problems.",
  inputSchema: z.object({}),
  run: async () => systemRollback(),
});
```

Update the tool count log: `ctx.logger.info(\`NixOS tools registered: 10 tools ...\`)`.

**Step 6: Run all NixOS tests**

Run: `npx vitest run src/tools/nixos/`
Expected: PASS

**Step 7: Commit**

```bash
git add src/tools/nixos/commands.ts src/tools/nixos/commands.test.ts src/tools/nixos/index.ts
git commit -m "feat: add NixOS auto-update tools (flake update, rebuild, rollback)"
```

---

### Task 7: NixOS auto-update standing directive

**Files:**
- Modify: `examples/workspaces/devops/IDENTITY.md`
- Modify: `nix/server-example.nix` (add NOPASSWD sudoers rule, add update tool policies)

**Context:** The devops agent should have a standing directive for weekly auto-updates: `cron:0 3 * * 0` (Sunday 3am). The action: "Run clawnix_flake_update, then clawnix_system_rebuild. If rebuild fails, run clawnix_system_rollback and notify me." The NixOS config needs `security.sudo.extraRules` for the clawnix service user.

**Step 1: Update devops identity**

```markdown
<!-- examples/workspaces/devops/IDENTITY.md -->
You are the DevOps agent for ClawNix. You monitor server health, manage NixOS configuration, handle deployments, and respond to infrastructure alerts. Be precise and systematic.

On first interaction, if no auto-update directive exists, create one:
- Trigger: cron:0 3 * * 0 (weekly, Sunday at 3am)
- Action: Run clawnix_flake_update to pull latest packages. Then run clawnix_system_rebuild to apply. If rebuild fails, run clawnix_system_rollback immediately and send a notification.
```

**Step 2: Add sudoers rule to server example**

In `nix/server-example.nix`, add:
```nix
security.sudo.extraRules = [{
  groups = [ "clawnix" ];
  commands = [
    { command = "/run/current-system/sw/bin/nixos-rebuild"; options = [ "NOPASSWD" ]; }
  ];
}];
```

Also update devops tools to include `"nixos"` and add policies:
```nix
agents.devops.security.toolPolicies = [
  { tool = "clawnix_flake_update"; effect = "allow"; }
  { tool = "clawnix_system_rebuild"; effect = "approve"; }
  { tool = "clawnix_system_rollback"; effect = "allow"; }
];
```

**Step 3: Commit**

```bash
git add examples/workspaces/devops/IDENTITY.md nix/server-example.nix
git commit -m "feat: add NixOS auto-update directive for devops agent with sudoers"
```

---

### Task 8: Systemd watchdog plugin

**Files:**
- Create: `src/tools/watchdog/index.ts`
- Create: `src/tools/watchdog/index.test.ts`

**Context:** systemd watchdog sends `WATCHDOG=1` via `sd_notify`. If the process doesn't ping within `WatchdogSec`, systemd restarts it. We use `node:dgram` to talk to the `$NOTIFY_SOCKET` unix datagram socket. The plugin also monitors journal for clawnix service failures using `journalctl`.

**Step 1: Write the failing test**

```typescript
// src/tools/watchdog/index.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { WatchdogPlugin, sdNotify } from "./index.js";
import { EventBus } from "../../core/event-bus.js";
import { StateStore } from "../../core/state.js";
import type { Tool } from "../../core/types.js";

describe("WatchdogPlugin", () => {
  it("registers clawnix_agent_health tool", async () => {
    const plugin = new WatchdogPlugin();
    const tools: Tool[] = [];
    const eventBus = new EventBus();
    const state = new StateStore(":memory:");

    await plugin.init({
      eventBus,
      state,
      config: {},
      registerTool: (t: Tool) => tools.push(t),
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    });

    expect(tools.map((t) => t.name)).toContain("clawnix_agent_health");
    await plugin.shutdown();
  });
});

describe("sdNotify", () => {
  it("no-ops when NOTIFY_SOCKET is not set", () => {
    delete process.env.NOTIFY_SOCKET;
    // Should not throw
    expect(() => sdNotify("WATCHDOG=1")).not.toThrow();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/tools/watchdog/index.test.ts`
Expected: FAIL — cannot resolve `./index.js`

**Step 3: Write implementation**

```typescript
// src/tools/watchdog/index.ts
import { z } from "zod";
import { createSocket } from "node:dgram";
import type { ClawNixPlugin, PluginContext } from "../../core/types.js";
import { runCommand } from "../nixos/commands.js";

export function sdNotify(message: string): void {
  const socketPath = process.env.NOTIFY_SOCKET;
  if (!socketPath) return;

  const sock = createSocket("unix_dgram");
  try {
    sock.send(Buffer.from(message), 0, message.length, socketPath);
  } finally {
    sock.close();
  }
}

export class WatchdogPlugin implements ClawNixPlugin {
  name = "watchdog";
  version = "0.1.0";
  private interval?: ReturnType<typeof setInterval>;

  async init(ctx: PluginContext): Promise<void> {
    // Ping watchdog every 15 seconds (WatchdogSec should be 30s+ in systemd)
    this.interval = setInterval(() => sdNotify("WATCHDOG=1"), 15_000);
    sdNotify("READY=1");

    ctx.registerTool({
      name: "clawnix_agent_health",
      description:
        "Check health of ClawNix agent services. Shows recent journal entries for failed or restarted clawnix services.",
      inputSchema: z.object({
        service: z.string().optional().describe("Specific service name (default: all clawnix-* services)"),
      }),
      run: async (input) => {
        const { service } = input as { service?: string };
        const unit = service ?? "clawnix-*";
        return runCommand("journalctl", [
          "-u", unit,
          "--since", "1 hour ago",
          "--priority", "warning",
          "--no-pager",
          "-n", "50",
        ]);
      },
    });

    ctx.logger.info("Watchdog plugin started (sd_notify ping every 15s)");
  }

  async shutdown(): Promise<void> {
    if (this.interval) clearInterval(this.interval);
    sdNotify("STOPPING=1");
  }
}
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run src/tools/watchdog/index.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/tools/watchdog/index.ts src/tools/watchdog/index.test.ts
git commit -m "feat: add systemd watchdog plugin with sd_notify and health tool"
```

---

### Task 9: Wire watchdog into agent-instance and NixOS module

**Files:**
- Modify: `src/core/agent-instance.ts` (add "watchdog" case to tool switch)
- Modify: `nix/module.nix` (add WatchdogSec, NotifyAccess to systemd service config)
- Modify: `nix/server-example.nix` (add "watchdog" to agent tools lists)

**Step 1: Add watchdog to agent-instance.ts**

```typescript
import { WatchdogPlugin } from "../tools/watchdog/index.js";

// In the switch:
case "watchdog":
  await pluginHost.register(new WatchdogPlugin(), {});
  break;
```

**Step 2: Add WatchdogSec to NixOS module**

In `nix/module.nix`, inside the `serviceConfig` block (after `Restart = "on-failure";`):
```nix
WatchdogSec = 60;
NotifyAccess = "main";
Type = "notify";
```

**Step 3: Add "watchdog" to server-example tools**

In `nix/server-example.nix`, add `"watchdog"` to each agent's tools list.

**Step 4: Run tests**

Run: `npx vitest run`
Expected: All pass

**Step 5: Commit**

```bash
git add src/core/agent-instance.ts nix/module.nix nix/server-example.nix
git commit -m "feat: wire watchdog into agent startup and NixOS systemd services"
```

---

### Task 10: mcp-playwright server

**Files:**
- Create: `mcp-servers/playwright/server.py`
- Create: `mcp-servers/playwright/test_server.py`

**Context:** Same pattern as mcp-browser: FastMCP server with tool functions. Uses Playwright for headless Chromium. Tools: `navigate`, `click`, `fill_form`, `screenshot`, `extract_data`. Browser profile is isolated per session (temp dir). No persistent cookies.

**Step 1: Write the failing test**

```python
# mcp-servers/playwright/test_server.py
import pytest
from unittest.mock import patch, MagicMock, AsyncMock

@pytest.fixture
def mock_playwright():
    """Mock the playwright browser."""
    with patch("server._get_page") as mock_get:
        page = AsyncMock()
        page.title = AsyncMock(return_value="Test Page")
        page.url = "https://example.com"
        page.content = AsyncMock(return_value="<html><body>Hello</body></html>")
        page.inner_text = AsyncMock(return_value="Hello")
        page.screenshot = AsyncMock(return_value=b"fake-png-data")
        mock_get.return_value = page
        yield page

def test_navigate(mock_playwright):
    from server import navigate
    result = navigate.fn(url="https://example.com")
    mock_playwright.goto.assert_called_once_with("https://example.com", wait_until="networkidle")

def test_click(mock_playwright):
    from server import click
    result = click.fn(selector="button.submit")
    mock_playwright.click.assert_called_once_with("button.submit")

def test_fill_form(mock_playwright):
    from server import fill_form
    result = fill_form.fn(selector="input[name=email]", value="test@example.com")
    mock_playwright.fill.assert_called_once_with("input[name=email]", "test@example.com")

def test_screenshot(mock_playwright):
    from server import screenshot
    result = screenshot.fn()
    mock_playwright.screenshot.assert_called_once()

def test_extract_data(mock_playwright):
    from server import extract_data
    result = extract_data.fn(selector="body")
    mock_playwright.inner_text.assert_called_once_with("body")
```

**Step 2: Run test to verify it fails**

Run: `cd mcp-servers/playwright && python -m pytest test_server.py -v`
Expected: FAIL — no server module

**Step 3: Write server implementation**

```python
# mcp-servers/playwright/server.py
"""ClawNix MCP server for headless browser automation via Playwright."""

import asyncio
import base64
import tempfile
from playwright.sync_api import sync_playwright, Page, Browser

from fastmcp import FastMCP

mcp = FastMCP(
    name="clawnix-mcp-playwright",
    instructions="Headless browser automation. Navigate pages, fill forms, click elements, take screenshots.",
)

_browser: Browser | None = None
_page: Page | None = None


def _get_page() -> Page:
    global _browser, _page
    if _page is None:
        pw = sync_playwright().start()
        _browser = pw.chromium.launch(
            headless=True,
            args=["--no-sandbox", "--disable-dev-shm-usage"],
        )
        context = _browser.new_context(
            user_agent="ClawNix/0.2.0 (headless browser automation)",
        )
        _page = context.new_page()
    return _page


@mcp.tool
def navigate(url: str) -> str:
    """Navigate to a URL and wait for the page to load. Returns page title and URL."""
    if not url.startswith(("http://", "https://")):
        return "Error: only http and https URLs are supported."
    page = _get_page()
    try:
        page.goto(url, wait_until="networkidle")
        return f"Navigated to: {page.url}\nTitle: {page.title()}"
    except Exception as e:
        return f"Error navigating to {url}: {e}"


@mcp.tool
def click(selector: str) -> str:
    """Click an element on the page by CSS selector."""
    page = _get_page()
    try:
        page.click(selector)
        return f"Clicked: {selector}\nCurrent URL: {page.url}"
    except Exception as e:
        return f"Error clicking {selector}: {e}"


@mcp.tool
def fill_form(selector: str, value: str) -> str:
    """Fill a form field with a value by CSS selector."""
    page = _get_page()
    try:
        page.fill(selector, value)
        return f"Filled {selector} with value"
    except Exception as e:
        return f"Error filling {selector}: {e}"


@mcp.tool
def screenshot() -> str:
    """Take a screenshot of the current page. Returns base64-encoded PNG."""
    page = _get_page()
    try:
        data = page.screenshot(full_page=True)
        encoded = base64.b64encode(data).decode("utf-8")
        return f"Screenshot captured ({len(data)} bytes).\nBase64: {encoded[:100]}..."
    except Exception as e:
        return f"Error taking screenshot: {e}"


@mcp.tool
def extract_data(selector: str) -> str:
    """Extract text content from an element by CSS selector."""
    page = _get_page()
    try:
        text = page.inner_text(selector)
        if len(text) > 10000:
            text = text[:10000] + "\n\n[Content truncated at 10,000 characters]"
        return text
    except Exception as e:
        return f"Error extracting from {selector}: {e}"


def main():
    mcp.run()


if __name__ == "__main__":
    main()
```

**Step 4: Run test to verify it passes**

Run: `cd mcp-servers/playwright && python -m pytest test_server.py -v`
Expected: PASS (5 tests)

**Step 5: Commit**

```bash
git add mcp-servers/playwright/server.py mcp-servers/playwright/test_server.py
git commit -m "feat: add mcp-playwright server for headless browser automation"
```

---

### Task 11: Nix packaging for mcp-playwright

**Files:**
- Create: `nix/mcp-playwright.nix`
- Modify: `flake.nix` (add mcp-playwright to packages)

**Context:** Same pattern as mcp-browser.nix: `writeShellScriptBin` + `python3.withPackages`. Playwright requires browser binaries — use `playwright-driver` from nixpkgs and set `PLAYWRIGHT_BROWSERS_PATH`.

**Step 1: Create Nix package**

```nix
# nix/mcp-playwright.nix
{ pkgs }:
let
  python = pkgs.python3.withPackages (ps: [
    ps.fastmcp
    ps.playwright
  ]);
  playwrightBrowsers = pkgs.playwright-driver.browsers;
in
pkgs.writeShellScriptBin "clawnix-mcp-playwright" ''
  export PLAYWRIGHT_BROWSERS_PATH="${playwrightBrowsers}"
  exec ${python}/bin/python ${../mcp-servers/playwright/server.py} "$@"
''
```

**Step 2: Add to flake.nix**

Add to the packages set:
```nix
mcp-playwright = import ./nix/mcp-playwright.nix { inherit pkgs; };
```

**Step 3: Verify build**

Run: `git add nix/mcp-playwright.nix flake.nix && nix flake check`
Expected: 0 errors

**Step 4: Commit**

```bash
git add nix/mcp-playwright.nix flake.nix
git commit -m "feat: add Nix packaging for mcp-playwright server"
```

---

### Task 12: Update server example with Phase 6 features

**Files:**
- Modify: `nix/server-example.nix`

**Context:** Add mcp-playwright to the global MCP servers. Add "delegation" and "watchdog" to all agent tools. Add tool policies for playwright (navigate/extract = auto, click/fill = approve). Add mcp-playwright server config.

**Step 1: Update server-example.nix**

Add to `mcp.servers`:
```nix
playwright = {
  command = "${self.packages.${pkgs.system}.mcp-playwright}/bin/clawnix-mcp-playwright";
};
```

Add `"delegation"` and `"watchdog"` to each agent's tools list.

Add tool policies for researcher:
```nix
agents.researcher.security.toolPolicies = [
  { tool = "navigate"; effect = "allow"; }
  { tool = "extract_data"; effect = "allow"; }
  { tool = "screenshot"; effect = "allow"; }
  { tool = "click"; effect = "approve"; }
  { tool = "fill_form"; effect = "approve"; }
];
```

**Step 2: Commit**

```bash
git add nix/server-example.nix
git commit -m "feat: add Phase 6 features to server example (playwright, delegation, watchdog)"
```

---

### Task 13: Update README with Phase 6 features

**Files:**
- Modify: `README.md`

**Context:** Add sections for agent-to-agent delegation, Telegram inline buttons, NixOS auto-updates, systemd watchdog, and mcp-playwright. Update MCP server table. Update tool count.

**Step 1: Update README sections**

Add mcp-playwright to the MCP servers table:
```markdown
| mcp-playwright | `navigate`, `click`, `fill_form`, `screenshot`, `extract_data` | Headless Chromium browser automation via Playwright |
```

Add to the README after the existing sections:

**Agent-to-agent delegation:** Agents can delegate tasks to other specialists using `clawnix_delegate` and `clawnix_list_agents` tools. The AgentBroker routes requests between agents.

**Telegram inline buttons:** Approval requests use inline keyboard buttons instead of text commands. Tap "Allow" or "Deny" directly in the Telegram message.

**NixOS auto-updates:** The devops agent can update the system with `clawnix_flake_update` (update flake.lock), `clawnix_system_rebuild` (apply config), and `clawnix_system_rollback` (revert on failure). Requires NOPASSWD sudo for nixos-rebuild.

**systemd watchdog:** Each agent service pings systemd via `sd_notify`. If an agent hangs, systemd automatically restarts it. `WatchdogSec=60` in the NixOS module.

**Step 2: Run tests to verify nothing broke**

Run: `npm test`
Expected: All pass

**Step 3: Commit**

```bash
git add README.md
git commit -m "docs: add Phase 6 features to README (delegation, inline buttons, watchdog, playwright)"
```

---

### Task 14: Final verification

**Files:** None (verification only)

**Step 1: Run full test suite**

Run: `npm test`
Expected: All TypeScript tests pass

**Step 2: Run Python tests**

Run:
```bash
cd mcp-servers/browser && python -m pytest test_server.py -v
cd ../documents && python -m pytest test_server.py -v
cd ../email && python -m pytest test_server.py -v
cd ../calendar && python -m pytest test_server.py -v
cd ../playwright && python -m pytest test_server.py -v
```
Expected: All Python tests pass

**Step 3: Nix flake check**

Run: `nix flake check`
Expected: 0 errors, 6 packages

**Step 4: Git log review**

Run: `git log --oneline -15`
Verify all Phase 6 commits are present and well-formed.
