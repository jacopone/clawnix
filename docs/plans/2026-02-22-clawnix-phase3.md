# ClawNix Phase 3: Server Foundation — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Rename nixclaw to clawnix, evolve the NixOS module to support multiple named agent instances, add a natural language router, bind the web UI to Tailscale only, integrate sops-nix for secrets, and produce a headless server NixOS config.

**Architecture:** The single-agent `services.nixclaw` module becomes `services.clawnix.agents.<name>`, where each named agent spawns its own systemd service with isolated state, personality, and tool policies. A new router layer sits between Telegram and the agents, using Haiku for intent classification. The existing codebase (~1,500 lines, 84 tests) stays intact — we refactor naming and add the multi-agent/router layers on top.

**Tech Stack:** TypeScript (ESM), Nix flake, NixOS module, Vitest, Anthropic SDK (Haiku for router), SQLite, Fastify, grammY.

---

## Task 1: Rename nixclaw → clawnix (codebase)

Rename all TypeScript references, package.json, config env var, and internal strings. Tests must still pass after.

**Files:**
- Modify: `package.json` (name, bin, description)
- Modify: `src/index.ts:19` (banner string)
- Modify: `src/core/config.ts:72-73` (default paths)
- Modify: `src/core/config.ts:77` (env var name)
- Modify: `src/core/state.ts` (any db name references)
- Modify: `src/core/agent.ts:24` (fallback config path)
- Modify: All test files referencing `nixclaw` in DB paths
- Test: All existing test files

**Step 1: Update package.json**

Change `name` from `"nixclaw"` to `"clawnix"`, `bin` key from `"nixclaw"` to `"clawnix"`.

```json
{"name":"clawnix","version":"0.2.0","description":"Personal AI agent platform for NixOS","bin":{"clawnix":"dist/index.js"}, ...}
```

**Step 2: Update src/index.ts banner**

```typescript
console.log("ClawNix v0.2.0 — starting...\n");
```

**Step 3: Update src/core/config.ts**

Change env var from `NIXCLAW_CONFIG` to `CLAWNIX_CONFIG`:

```typescript
export function loadConfig(): NixClawConfig {
  const envConfig = process.env.CLAWNIX_CONFIG;
  if (envConfig) return { ...DEFAULT_CONFIG, ...JSON.parse(envConfig) };
  return DEFAULT_CONFIG;
}
```

Change default paths:

```typescript
workspaceDir: join(homedir(), ".config/clawnix"),
stateDir: join(homedir(), ".local/share/clawnix"),
```

**Step 4: Update src/core/agent.ts fallback path**

```typescript
this.systemPrompt = loadPersonality(config.workspaceDir ?? join(homedir(), ".config/clawnix"));
```

**Step 5: Update state DB filename in src/index.ts:26**

```typescript
const state = new StateStore(`${config.stateDir}/clawnix.db`);
```

**Step 6: Update test DB paths**

Search all test files for `nixclaw` in temp DB paths (e.g., `/tmp/nixclaw-*-test.db`) and rename to `clawnix`. Also update `src/core/config.test.ts` to reference `CLAWNIX_CONFIG`.

**Step 7: Run tests**

Run: `cd /home/guyfawkes/nixclaw && npx vitest run`
Expected: All 84+ tests pass.

**Step 8: Commit**

```bash
git add -A
git commit -m "refactor: rename nixclaw to clawnix across codebase"
```

---

## Task 2: Rename nixclaw → clawnix (Nix layer)

Rename the flake, module, and binary.

**Files:**
- Modify: `flake.nix` (description, pname, bin name)
- Modify: `nix/module.nix` (options namespace, service name, ExecStart)

**Step 1: Update flake.nix**

```nix
{
  description = "ClawNix - Personal AI agent platform for NixOS";
  # ...
  packages.${system}.default = pkgs.buildNpmPackage {
    pname = "clawnix";
    version = "0.2.0";
    # ...
    installPhase = ''
      runHook preInstall
      mkdir -p $out/bin $out/lib/clawnix
      cp -r dist/* $out/lib/clawnix/
      cp -r node_modules $out/lib/clawnix/
      cat > $out/bin/clawnix <<EOF
      #!/bin/sh
      exec ${pkgs.nodejs_22}/bin/node $out/lib/clawnix/index.js "\$@"
      EOF
      chmod +x $out/bin/clawnix
      runHook postInstall
    '';
  };
  nixosModules.default = import ./nix/module.nix { inherit self; };
  # ...
}
```

**Step 2: Update nix/module.nix namespace**

Change `config.services.nixclaw` to `config.services.clawnix` throughout. Change `NIXCLAW_CONFIG` to `CLAWNIX_CONFIG`. Change `ExecStart` binary path. Change `StateDirectory` to `"clawnix"`. This is a find-and-replace of `nixclaw` → `clawnix` throughout the file.

**Step 3: Verify Nix evaluation**

Run: `cd /home/guyfawkes/nixclaw && nix flake check`
Expected: No errors (check may warn about missing npmDepsHash update — address in next step).

**Step 4: Update npmDepsHash if needed**

If the `nix build` fails because `package.json` changed, update the hash:

Run: `nix build .#default 2>&1 | grep "got:"`

Update the `npmDepsHash` in `flake.nix` with the new value.

**Step 5: Commit**

```bash
git add flake.nix nix/module.nix
git commit -m "refactor: rename nixclaw to clawnix in Nix layer"
```

---

## Task 3: Rename TypeScript interfaces

Rename `NixClawConfig`, `NixClawPlugin`, `NixClawMessage` to `ClawNixConfig`, `ClawNixPlugin`, `ClawNixMessage`. This makes the naming consistent.

**Files:**
- Modify: `src/core/types.ts` (interface names)
- Modify: `src/core/config.ts` (type name)
- Modify: Every file importing these types
- Test: All existing test files

**Step 1: Rename in src/core/types.ts**

```typescript
export interface ClawNixMessage { ... }
export interface ClawNixPlugin { ... }
```

**Step 2: Rename in src/core/config.ts**

```typescript
export interface ClawNixConfig { ... }
export function loadConfig(): ClawNixConfig { ... }
```

**Step 3: Update all imports**

Use find-and-replace across all `.ts` files:
- `NixClawConfig` → `ClawNixConfig`
- `NixClawPlugin` → `ClawNixPlugin`
- `NixClawMessage` → `ClawNixMessage`

These appear in: `agent.ts`, `plugin-host.ts`, `index.ts`, all channel files, all tool files, and their tests.

**Step 4: Run tests**

Run: `cd /home/guyfawkes/nixclaw && npx vitest run`
Expected: All tests pass.

**Step 5: Commit**

```bash
git add -A
git commit -m "refactor: rename NixClaw* interfaces to ClawNix*"
```

---

## Task 4: Rename tool prefixes

All tool names currently use `nixclaw_` prefix (e.g., `nixclaw_processes`, `nixclaw_resources`). Rename to `clawnix_`.

**Files:**
- Modify: `src/tools/observe/index.ts` (all tool name strings)
- Modify: `src/tools/nixos/index.ts` (all tool name strings)
- Modify: `src/tools/dev/index.ts` (all tool name strings)
- Modify: `src/tools/scheduler/index.ts` (tool name string)
- Modify: Corresponding test files
- Test: All test files

**Step 1: Find and replace tool name prefixes**

In all tool plugin files, replace `nixclaw_` with `clawnix_` in the `name` field of registered tools. Also update test assertions that check tool names.

**Step 2: Run tests**

Run: `cd /home/guyfawkes/nixclaw && npx vitest run`
Expected: All tests pass.

**Step 3: Commit**

```bash
git add -A
git commit -m "refactor: rename nixclaw_ tool prefix to clawnix_"
```

---

## Task 5: Multi-agent config schema

Add support for named agent instances in the TypeScript config. The config shape changes from a single agent to a map of agents.

**Files:**
- Modify: `src/core/config.ts` (add `agents` field to config)
- Create: `src/core/config.test.ts` (update existing tests + add multi-agent test)

**Step 1: Write the failing test**

In `src/core/config.test.ts`, add:

```typescript
it("loads multi-agent configuration", () => {
  const multiConfig = {
    agents: {
      personal: {
        description: "daily assistant",
        ai: { provider: "claude", model: "claude-sonnet-4-6", apiKeyFile: "/tmp/key" },
        tools: ["nixos", "observe", "dev"],
        mcp: { servers: ["browser", "documents"] },
        workspaceDir: "/var/lib/clawnix/personal",
        toolPolicies: [],
      },
      devops: {
        description: "infrastructure monitoring",
        ai: { provider: "claude", model: "claude-sonnet-4-6", apiKeyFile: "/tmp/key" },
        tools: ["nixos", "observe"],
        mcp: { servers: ["browser"] },
        workspaceDir: "/var/lib/clawnix/devops",
        toolPolicies: [],
      },
    },
  };
  process.env.CLAWNIX_CONFIG = JSON.stringify(multiConfig);
  const config = loadConfig();
  expect(config.agents).toBeDefined();
  expect(config.agents!.personal.description).toBe("daily assistant");
  expect(config.agents!.devops.tools).toEqual(["nixos", "observe"]);
  delete process.env.CLAWNIX_CONFIG;
});
```

**Step 2: Run test to verify it fails**

Run: `cd /home/guyfawkes/nixclaw && npx vitest run src/core/config.test.ts`
Expected: FAIL — `agents` property does not exist on config.

**Step 3: Implement the AgentInstanceConfig type**

In `src/core/config.ts`, add:

```typescript
export interface AgentInstanceConfig {
  description: string;
  ai: { provider: "claude"; model: string; apiKeyFile: string };
  tools: string[];
  mcp: { servers: string[] };
  workspaceDir: string;
  toolPolicies: Array<{
    tool: string;
    effect: "allow" | "deny" | "approve";
    channels?: string[];
    users?: string[];
  }>;
  channels?: {
    telegram?: { enable: boolean };
    webui?: { enable: boolean; port?: number; host?: string };
  };
}
```

Add `agents?: Record<string, AgentInstanceConfig>` to `ClawNixConfig`.

**Step 4: Run tests**

Run: `cd /home/guyfawkes/nixclaw && npx vitest run`
Expected: All tests pass.

**Step 5: Commit**

```bash
git add src/core/config.ts src/core/config.test.ts
git commit -m "feat: add multi-agent configuration schema"
```

---

## Task 6: Agent instance factory

Create a function that bootstraps a single agent instance from an `AgentInstanceConfig`. This extracts the bootstrap logic from `src/index.ts` into a reusable factory.

**Files:**
- Create: `src/core/agent-instance.ts`
- Create: `src/core/agent-instance.test.ts`

**Step 1: Write the failing test**

```typescript
// src/core/agent-instance.test.ts
import { describe, it, expect, vi } from "vitest";
import { createAgentInstance } from "./agent-instance.js";

describe("createAgentInstance", () => {
  it("creates an instance with the given name and config", async () => {
    const instance = await createAgentInstance("personal", {
      description: "daily assistant",
      ai: { provider: "claude", model: "claude-sonnet-4-6", apiKeyFile: "/dev/null" },
      tools: [],
      mcp: { servers: [] },
      workspaceDir: "/tmp/clawnix-test-personal",
      toolPolicies: [],
    }, { stateDir: "/tmp/clawnix-test" });

    expect(instance.name).toBe("personal");
    expect(instance.description).toBe("daily assistant");
    expect(instance.pluginHost).toBeDefined();
    expect(instance.eventBus).toBeDefined();
    await instance.shutdown();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd /home/guyfawkes/nixclaw && npx vitest run src/core/agent-instance.test.ts`
Expected: FAIL — module not found.

**Step 3: Implement the factory**

```typescript
// src/core/agent-instance.ts
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
```

**Step 4: Run tests**

Run: `cd /home/guyfawkes/nixclaw && npx vitest run`
Expected: All tests pass.

**Step 5: Commit**

```bash
git add src/core/agent-instance.ts src/core/agent-instance.test.ts
git commit -m "feat: add agent instance factory for multi-agent support"
```

---

## Task 7: Natural language router

Create a router that classifies incoming messages to the correct agent using Haiku.

**Files:**
- Create: `src/core/router.ts`
- Create: `src/core/router.test.ts`

**Step 1: Write the failing test**

```typescript
// src/core/router.test.ts
import { describe, it, expect, vi } from "vitest";
import { Router, parseRoutePrefix } from "./router.js";

describe("parseRoutePrefix", () => {
  it("extracts prefix and message from /p check calendar", () => {
    const result = parseRoutePrefix("/p check my calendar");
    expect(result).toEqual({ prefix: "p", message: "check my calendar" });
  });

  it("returns null for messages without prefix", () => {
    const result = parseRoutePrefix("check my calendar");
    expect(result).toBeNull();
  });
});

describe("Router", () => {
  it("builds classification prompt from agent descriptions", () => {
    const router = new Router({
      personal: { description: "calendar, reminders, general", prefix: "p" },
      devops: { description: "server health, NixOS, deployments", prefix: "d" },
    });
    const prompt = router.getClassificationPrompt();
    expect(prompt).toContain("personal");
    expect(prompt).toContain("calendar, reminders, general");
    expect(prompt).toContain("devops");
  });

  it("routes via prefix override without LLM call", async () => {
    const router = new Router({
      personal: { description: "calendar", prefix: "p" },
      devops: { description: "servers", prefix: "d" },
    });
    const result = await router.route("/d check nginx", { classify: vi.fn() });
    expect(result.agent).toBe("devops");
    expect(result.message).toBe("check nginx");
    expect(result.method).toBe("prefix");
  });

  it("falls back to LLM classification when no prefix", async () => {
    const mockClassify = vi.fn().mockResolvedValue("devops");
    const router = new Router({
      personal: { description: "calendar", prefix: "p" },
      devops: { description: "servers", prefix: "d" },
    });
    const result = await router.route("check if nginx is healthy", { classify: mockClassify });
    expect(result.agent).toBe("devops");
    expect(result.method).toBe("classification");
    expect(mockClassify).toHaveBeenCalled();
  });

  it("returns AMBIGUOUS when classifier is unsure", async () => {
    const mockClassify = vi.fn().mockResolvedValue("AMBIGUOUS");
    const router = new Router({
      personal: { description: "calendar", prefix: "p" },
      devops: { description: "servers", prefix: "d" },
    });
    const result = await router.route("do something", { classify: mockClassify });
    expect(result.agent).toBeNull();
    expect(result.method).toBe("ambiguous");
  });

  it("skips routing when only one agent is configured", async () => {
    const router = new Router({
      personal: { description: "everything", prefix: "p" },
    });
    const result = await router.route("do anything", { classify: vi.fn() });
    expect(result.agent).toBe("personal");
    expect(result.method).toBe("single");
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd /home/guyfawkes/nixclaw && npx vitest run src/core/router.test.ts`
Expected: FAIL — module not found.

**Step 3: Implement the router**

```typescript
// src/core/router.ts

export interface AgentRoute {
  description: string;
  prefix: string;
}

export interface RouteResult {
  agent: string | null;
  message: string;
  method: "prefix" | "classification" | "ambiguous" | "single";
}

export interface Classifier {
  classify: (prompt: string, message: string) => Promise<string>;
}

export function parseRoutePrefix(text: string): { prefix: string; message: string } | null {
  const match = text.match(/^\/([a-z])\s+(.+)$/s);
  if (!match) return null;
  return { prefix: match[1], message: match[2] };
}

export class Router {
  private agents: Record<string, AgentRoute>;
  private prefixMap: Map<string, string>;

  constructor(agents: Record<string, AgentRoute>) {
    this.agents = agents;
    this.prefixMap = new Map();
    for (const [name, route] of Object.entries(agents)) {
      this.prefixMap.set(route.prefix, name);
    }
  }

  getClassificationPrompt(): string {
    const lines = Object.entries(this.agents)
      .map(([name, route]) => `- ${name}: ${route.description}`)
      .join("\n");
    return [
      "You route user messages to the correct agent. Reply with ONLY the agent name.",
      "If unclear, reply: AMBIGUOUS",
      "",
      "Agents:",
      lines,
    ].join("\n");
  }

  async route(text: string, classifier: Classifier): Promise<RouteResult> {
    const agentNames = Object.keys(this.agents);

    // Single agent: skip routing
    if (agentNames.length === 1) {
      return { agent: agentNames[0], message: text, method: "single" };
    }

    // Prefix override
    const prefixResult = parseRoutePrefix(text);
    if (prefixResult) {
      const agent = this.prefixMap.get(prefixResult.prefix);
      if (agent) {
        return { agent, message: prefixResult.message, method: "prefix" };
      }
    }

    // LLM classification
    const prompt = this.getClassificationPrompt();
    const classification = await classifier.classify(prompt, text);
    const normalized = classification.trim().toLowerCase();

    if (normalized === "ambiguous" || !agentNames.includes(normalized)) {
      return { agent: null, message: text, method: "ambiguous" };
    }

    return { agent: normalized, message: text, method: "classification" };
  }
}
```

**Step 4: Run tests**

Run: `cd /home/guyfawkes/nixclaw && npx vitest run`
Expected: All tests pass.

**Step 5: Commit**

```bash
git add src/core/router.ts src/core/router.test.ts
git commit -m "feat: add natural language router with prefix override and Haiku classification"
```

---

## Task 8: Haiku classifier client

Create a lightweight classifier that calls Haiku for message routing.

**Files:**
- Create: `src/ai/classifier.ts`
- Create: `src/ai/classifier.test.ts`

**Step 1: Write the failing test**

```typescript
// src/ai/classifier.test.ts
import { describe, it, expect, vi } from "vitest";
import { HaikuClassifier } from "./classifier.js";

describe("HaikuClassifier", () => {
  it("calls Anthropic API with haiku model and returns classification", async () => {
    const mockCreate = vi.fn().mockResolvedValue({
      content: [{ type: "text", text: "devops" }],
    });

    const classifier = new HaikuClassifier("test-key");
    // Inject mock client
    (classifier as any).client = { messages: { create: mockCreate } };

    const result = await classifier.classify(
      "Route to the correct agent:\n- personal: calendar\n- devops: servers",
      "check nginx health"
    );

    expect(result).toBe("devops");
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 50,
      })
    );
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd /home/guyfawkes/nixclaw && npx vitest run src/ai/classifier.test.ts`
Expected: FAIL — module not found.

**Step 3: Implement the classifier**

```typescript
// src/ai/classifier.ts
import Anthropic from "@anthropic-ai/sdk";
import type { Classifier } from "../core/router.js";

export class HaikuClassifier implements Classifier {
  private client: Anthropic;

  constructor(apiKey: string) {
    this.client = new Anthropic({ apiKey });
  }

  async classify(systemPrompt: string, message: string): Promise<string> {
    const response = await this.client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 50,
      system: systemPrompt,
      messages: [{ role: "user", content: message }],
    });

    const text = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("")
      .trim();

    return text;
  }
}
```

**Step 4: Run tests**

Run: `cd /home/guyfawkes/nixclaw && npx vitest run`
Expected: All tests pass.

**Step 5: Commit**

```bash
git add src/ai/classifier.ts src/ai/classifier.test.ts
git commit -m "feat: add Haiku classifier for natural language routing"
```

---

## Task 9: Wire multi-agent + router into main entry point

Refactor `src/index.ts` to support both single-agent (backward compatible) and multi-agent modes. When `config.agents` is defined, spawn one agent instance per entry and wire the router.

**Files:**
- Modify: `src/index.ts`
- Create: `src/index-multi.test.ts` (integration-level test for the multi-agent wiring)

**Step 1: Write the failing test**

```typescript
// src/index-multi.test.ts
import { describe, it, expect } from "vitest";
import { buildAgentRoutes } from "./index.js";

describe("buildAgentRoutes", () => {
  it("builds route map from agent configs", () => {
    const routes = buildAgentRoutes({
      personal: {
        description: "calendar, reminders",
        ai: { provider: "claude", model: "m", apiKeyFile: "/dev/null" },
        tools: [], mcp: { servers: [] },
        workspaceDir: "/tmp/p", toolPolicies: [],
      },
      devops: {
        description: "server health",
        ai: { provider: "claude", model: "m", apiKeyFile: "/dev/null" },
        tools: [], mcp: { servers: [] },
        workspaceDir: "/tmp/d", toolPolicies: [],
      },
    });
    expect(routes.personal.description).toBe("calendar, reminders");
    expect(routes.personal.prefix).toBe("p");
    expect(routes.devops.prefix).toBe("d");
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd /home/guyfawkes/nixclaw && npx vitest run src/index-multi.test.ts`
Expected: FAIL — `buildAgentRoutes` not exported.

**Step 3: Refactor src/index.ts**

Extract `buildAgentRoutes` as a named export. The function derives route prefixes from the first letter of each agent name (with collision avoidance):

```typescript
import type { AgentInstanceConfig } from "./core/config.js";
import type { AgentRoute } from "./core/router.js";

export function buildAgentRoutes(
  agents: Record<string, AgentInstanceConfig>,
): Record<string, AgentRoute> {
  const routes: Record<string, AgentRoute> = {};
  const usedPrefixes = new Set<string>();

  for (const [name, config] of Object.entries(agents)) {
    let prefix = name[0].toLowerCase();
    // Handle collisions: try second char, then third, etc.
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
```

The `main()` function gets a new branch: if `config.agents` is defined, it iterates over entries, calling `createAgentInstance()` for each, then creates a `Router` and wires the Telegram channel's incoming messages through the router before dispatching to the correct agent's event bus.

Keep the existing single-agent path as fallback when `config.agents` is not set.

**Step 4: Run tests**

Run: `cd /home/guyfawkes/nixclaw && npx vitest run`
Expected: All tests pass (including existing integration test).

**Step 5: Commit**

```bash
git add src/index.ts src/index-multi.test.ts
git commit -m "feat: wire multi-agent support and router into main entry point"
```

---

## Task 10: Evolve NixOS module to multi-agent

Transform `nix/module.nix` from a single `services.clawnix` service to `services.clawnix.agents.<name>` with a systemd service per agent.

**Files:**
- Modify: `nix/module.nix`

**Step 1: Restructure module options**

Replace the flat config with an `agents` attrset using `lib.types.attrsOf (lib.types.submodule { ... })`. Each agent submodule contains: `description`, `ai`, `channels`, `voice`, `tools`, `mcp`, `security`, `workspaceDir`.

Global options remain at the top level: `services.clawnix.enable`, `services.clawnix.stateDir`, `services.clawnix.router.model` (defaults to `"claude-haiku-4-5-20251001"`).

**Step 2: Generate per-agent systemd services**

Use `lib.mapAttrs'` to create `systemd.services.clawnix-${name}` for each agent:

```nix
systemd.services = lib.mapAttrs' (name: agentCfg:
  lib.nameValuePair "clawnix-${name}" {
    description = "ClawNix Agent: ${name}";
    after = [ "network-online.target" ];
    wants = [ "network-online.target" ];
    wantedBy = [ "multi-user.target" ];

    environment.CLAWNIX_CONFIG = builtins.toJSON {
      agents = { ${name} = { /* agent config */ }; };
      stateDir = cfg.stateDir;
    };

    serviceConfig = {
      ExecStart = "${self.packages.${pkgs.system}.default}/bin/clawnix";
      DynamicUser = true;
      StateDirectory = "clawnix/${name}";
      ProtectSystem = "strict";
      ProtectHome = "read-only";
      ReadWritePaths = [ "${cfg.stateDir}/${name}" agentCfg.workspaceDir ];
      NoNewPrivileges = true;
      PrivateTmp = true;
      RestartSec = 10;
      Restart = "on-failure";
    };
  }
) cfg.agents;
```

**Step 3: Verify Nix evaluation**

Run: `cd /home/guyfawkes/nixclaw && nix flake check`
Expected: No errors.

**Step 4: Commit**

```bash
git add nix/module.nix
git commit -m "feat: evolve NixOS module to support named multi-agent instances"
```

---

## Task 11: Tailscale-only web UI binding

Add a `services.clawnix.tailscaleInterface` option. When set, the web UI binds only to the Tailscale interface IP instead of 127.0.0.1. Remove the firewall rule for the web UI port (no public exposure).

**Files:**
- Modify: `nix/module.nix` (add option, adjust web UI host)

**Step 1: Add the option**

```nix
services.clawnix.tailscaleInterface = lib.mkOption {
  type = lib.types.nullOr lib.types.str;
  default = null;
  description = "Tailscale interface name (e.g., 'tailscale0'). When set, web UI binds to this interface only.";
  example = "tailscale0";
};
```

**Step 2: Adjust web UI host resolution**

In the agent config generation, when `cfg.tailscaleInterface` is set and the agent has `channels.webui.enable = true`, override the host to `"0.0.0.0"` (the firewall restricts access) or use a script that resolves the Tailscale IP at service start.

A simpler approach: add an `ExecStartPre` script that reads the Tailscale IP:

```nix
ExecStartPre = lib.mkIf (cfg.tailscaleInterface != null) (
  pkgs.writeShellScript "resolve-tailscale-ip" ''
    ip=$(${pkgs.iproute2}/bin/ip -4 addr show ${cfg.tailscaleInterface} | grep -oP 'inet \K[\d.]+')
    echo "CLAWNIX_TAILSCALE_IP=$ip" > /run/clawnix/tailscale-env
  ''
);
```

And in the TypeScript web UI channel, read `CLAWNIX_TAILSCALE_IP` as the bind address when available.

**Step 3: Remove public firewall rule**

Remove the `networking.firewall.allowedTCPPorts` line for the web UI port. Access is Tailscale-only.

**Step 4: Commit**

```bash
git add nix/module.nix
git commit -m "feat: add Tailscale-only web UI binding"
```

---

## Task 12: sops-nix secrets integration

Add sops-nix secret references to the module so API keys and tokens are encrypted at rest.

**Files:**
- Modify: `nix/module.nix` (read secrets from files at runtime)

**Step 1: Update module to use file-based secrets**

The module already uses `apiKeyFile` and `botTokenFile` — these are paths to files containing secrets. This design is sops-nix compatible out of the box: users point these options to `config.sops.secrets.<name>.path`.

Add documentation comments to the module clarifying the sops-nix pattern:

```nix
ai.apiKeyFile = lib.mkOption {
  type = lib.types.path;
  description = ''
    Path to file containing the Anthropic API key.
    When using sops-nix: config.sops.secrets.anthropic-api-key.path
  '';
};
```

**Step 2: Add SupplementaryGroups for secret access**

When using sops-nix, secrets are owned by root with group access. Add:

```nix
serviceConfig.SupplementaryGroups = lib.mkIf (cfg.secretsGroup != null) [ cfg.secretsGroup ];
```

With a new option:

```nix
services.clawnix.secretsGroup = lib.mkOption {
  type = lib.types.nullOr lib.types.str;
  default = null;
  description = "Group for accessing sops-nix secrets (e.g., 'keys')";
};
```

**Step 3: Verify Nix evaluation**

Run: `cd /home/guyfawkes/nixclaw && nix flake check`
Expected: No errors.

**Step 4: Commit**

```bash
git add nix/module.nix
git commit -m "feat: add sops-nix secrets integration with SupplementaryGroups"
```

---

## Task 13: Headless server NixOS config example

Create an example NixOS configuration for the dedicated server laptop.

**Files:**
- Create: `nix/server-example.nix`

**Step 1: Write the example configuration**

```nix
# nix/server-example.nix
# Example NixOS configuration for a dedicated ClawNix server laptop.
# Copy and adapt for your hardware.
{ config, pkgs, ... }:
{
  # Headless operation: lid closed, no display manager
  services.logind.lidSwitch = "ignore";
  services.logind.lidSwitchExternalPower = "ignore";

  # Tailscale for remote access
  services.tailscale.enable = true;

  # sops-nix secrets (users provide their own .sops.yaml and secrets file)
  # sops.defaultSopsFile = ./secrets.yaml;
  # sops.secrets.anthropic-api-key = {};
  # sops.secrets.telegram-bot-token = {};

  # ClawNix agent
  services.clawnix = {
    enable = true;
    stateDir = "/var/lib/clawnix";
    tailscaleInterface = "tailscale0";

    agents.personal = {
      description = "calendar, reminders, daily tasks, general questions";
      ai = {
        model = "claude-sonnet-4-6";
        # apiKeyFile = config.sops.secrets.anthropic-api-key.path;
        apiKeyFile = "/run/secrets/anthropic-api-key"; # placeholder
      };
      channels.telegram = {
        enable = true;
        # botTokenFile = config.sops.secrets.telegram-bot-token.path;
        botTokenFile = "/run/secrets/telegram-bot-token"; # placeholder
      };
      channels.webui.enable = true;
      tools = [ "nixos" "observe" "dev" "scheduler" "heartbeat" ];
      workspaceDir = "/var/lib/clawnix/personal";
    };
  };

  # Power management for always-on operation
  powerManagement.enable = true;
  services.thermald.enable = true;

  # Minimal packages
  environment.systemPackages = with pkgs; [
    vim
    git
    htop
    tailscale
  ];

  # Firewall: only SSH, everything else via Tailscale
  networking.firewall = {
    enable = true;
    allowedTCPPorts = [ 22 ];
  };

  # Enable SSH for emergency access
  services.openssh = {
    enable = true;
    settings = {
      PasswordAuthentication = false;
      PermitRootLogin = "no";
    };
  };
}
```

**Step 2: Verify it evaluates**

Run: `cd /home/guyfawkes/nixclaw && nix flake check`
Expected: No errors (the example isn't imported by the flake, but syntax should be valid).

**Step 3: Commit**

```bash
git add nix/server-example.nix
git commit -m "feat: add example NixOS config for dedicated ClawNix server laptop"
```

---

## Task 14: Update README

Update the README to reflect the rename and Phase 3 capabilities.

**Files:**
- Modify: `README.md`

**Step 1: Update project name, description, and examples**

Replace all references to `nixclaw`/`NixClaw` with `clawnix`/`ClawNix`. Update the NixOS module example to show the multi-agent config. Add a section about the server deployment.

**Step 2: Run full test suite one final time**

Run: `cd /home/guyfawkes/nixclaw && npx vitest run`
Expected: All tests pass.

Run: `cd /home/guyfawkes/nixclaw && nix flake check`
Expected: No errors.

**Step 3: Commit**

```bash
git add README.md
git commit -m "docs: update README for ClawNix rename and Phase 3"
```

---

## Summary

| Task | Description | New files | Modified files |
|------|-------------|-----------|----------------|
| 1 | Rename TS codebase | — | package.json, index.ts, config.ts, agent.ts, all tests |
| 2 | Rename Nix layer | — | flake.nix, module.nix |
| 3 | Rename TS interfaces | — | types.ts, config.ts, ~20 importing files |
| 4 | Rename tool prefixes | — | all tool plugins + tests |
| 5 | Multi-agent config schema | — | config.ts, config.test.ts |
| 6 | Agent instance factory | agent-instance.ts, .test.ts | — |
| 7 | Natural language router | router.ts, .test.ts | — |
| 8 | Haiku classifier | classifier.ts, .test.ts | — |
| 9 | Wire multi-agent + router | index-multi.test.ts | index.ts |
| 10 | Multi-agent NixOS module | — | module.nix |
| 11 | Tailscale web UI binding | — | module.nix |
| 12 | sops-nix secrets | — | module.nix |
| 13 | Server config example | server-example.nix | — |
| 14 | Update README | — | README.md |

14 tasks. Rename first (tasks 1-4), then build new capabilities (tasks 5-9), then NixOS integration (tasks 10-13), then docs (task 14).
