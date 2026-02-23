import { describe, it, expect, vi } from "vitest";
import { ExecPlugin } from "./index.js";
import { EventBus } from "../../core/event-bus.js";
import { StateStore } from "../../core/state.js";
import type { PluginContext, Tool } from "../../core/types.js";
import { unlinkSync } from "node:fs";

const TEST_DB = "/tmp/clawnix-exec-test.db";

function makeCtx(config: Record<string, unknown> = {}): { ctx: PluginContext; tools: Tool[]; state: StateStore } {
  const bus = new EventBus();
  const state = new StateStore(TEST_DB);
  const tools: Tool[] = [];
  const ctx: PluginContext = {
    eventBus: bus,
    registerTool: (t) => tools.push(t),
    state,
    config,
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  };
  return { ctx, tools, state };
}

describe("ExecPlugin", () => {
  it("registers clawnix_exec tool on init", async () => {
    const plugin = new ExecPlugin();
    const { ctx, tools, state } = makeCtx({ allowedPackages: ["jq"] });

    await plugin.init(ctx);

    expect(tools).toHaveLength(1);
    expect(tools[0].name).toBe("clawnix_exec");

    state.close();
    try { unlinkSync(TEST_DB); } catch {}
  });

  it("blocks commands with forbidden patterns", async () => {
    const plugin = new ExecPlugin();
    const { ctx, tools, state } = makeCtx({ allowedPackages: ["coreutils"] });

    await plugin.init(ctx);
    const tool = tools[0];

    const result = await tool.run({ package: "coreutils", command: "sudo rm -rf /" });
    expect(result).toContain("BLOCKED");

    const result2 = await tool.run({ package: "coreutils", command: "echo $(whoami)" });
    expect(result2).toContain("BLOCKED");

    const result3 = await tool.run({ package: "coreutils", command: "cat /etc/passwd; rm -rf /" });
    expect(result3).toContain("BLOCKED");

    state.close();
    try { unlinkSync(TEST_DB); } catch {}
  });

  it("executes allowed packages via nix shell", async () => {
    const plugin = new ExecPlugin();
    const { ctx, tools, state } = makeCtx({ allowedPackages: ["coreutils"] });

    await plugin.init(ctx);
    const tool = tools[0];

    const result = await tool.run({ package: "coreutils", command: "echo hello-from-nix" });
    expect(result).toContain("hello-from-nix");

    state.close();
    try { unlinkSync(TEST_DB); } catch {}
  });

  it("handles timeout", async () => {
    const plugin = new ExecPlugin();
    const { ctx, tools, state } = makeCtx({ allowedPackages: ["coreutils"], defaultTimeout: 2 });

    await plugin.init(ctx);
    const tool = tools[0];

    const result = await tool.run({ package: "coreutils", command: "sleep 10", timeout: 2 });
    expect(result).toContain("timed out");

    state.close();
    try { unlinkSync(TEST_DB); } catch {}
  });

  it("caps timeout at 300 seconds", async () => {
    const plugin = new ExecPlugin();
    const { ctx, tools, state } = makeCtx({ allowedPackages: ["coreutils"] });

    await plugin.init(ctx);
    const tool = tools[0];

    // This just verifies the tool runs with a large timeout without error
    const result = await tool.run({ package: "coreutils", command: "echo ok", timeout: 9999 });
    expect(result).toContain("ok");

    state.close();
    try { unlinkSync(TEST_DB); } catch {}
  });
});
