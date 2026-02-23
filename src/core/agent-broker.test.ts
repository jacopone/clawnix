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
