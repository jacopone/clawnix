import { describe, it, expect, vi } from "vitest";
import { AgentBroker } from "./agent-broker.js";
import type { DelegationRequest, DelegationResponse, DelegationRecord, AuditRecorder } from "./agent-broker.js";

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

  it("records audit entries for successful delegations", async () => {
    const records: Omit<DelegationRecord, "id">[] = [];
    const broker = new AgentBroker({ auditRecorder: (r) => records.push(r) });
    broker.registerAgent("worker", vi.fn().mockResolvedValue("done"));

    await broker.delegate({ from: "boss", to: "worker", task: "build thing" });

    expect(records).toHaveLength(1);
    expect(records[0].fromAgent).toBe("boss");
    expect(records[0].toAgent).toBe("worker");
    expect(records[0].status).toBe("completed");
    expect(records[0].durationMs).toBeGreaterThanOrEqual(0);
  });

  it("records audit entries for failed delegations", async () => {
    const records: Omit<DelegationRecord, "id">[] = [];
    const broker = new AgentBroker({ auditRecorder: (r) => records.push(r) });
    broker.registerAgent("broken", vi.fn().mockRejectedValue(new Error("oops")));

    await broker.delegate({ from: "boss", to: "broken", task: "fail" });

    expect(records).toHaveLength(1);
    expect(records[0].status).toBe("error");
    expect(records[0].result).toContain("oops");
  });

  it("enforces max delegation depth", async () => {
    const broker = new AgentBroker({ maxDepth: 2 });

    // Agent "a" delegates to "b", "b" delegates to "c", "c" should fail
    let callDepth = 0;
    broker.registerAgent("a", async (req) => {
      callDepth++;
      const r = await broker.delegate({ from: "a", to: "b", task: "sub1" });
      return r.result;
    });
    broker.registerAgent("b", async (req) => {
      callDepth++;
      const r = await broker.delegate({ from: "b", to: "c", task: "sub2" });
      return r.result;
    });
    broker.registerAgent("c", vi.fn().mockResolvedValue("deep"));

    const result = await broker.delegate({ from: "root", to: "a", task: "start" });
    expect(result.result).toContain("depth limit");
  });
});
