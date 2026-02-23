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
