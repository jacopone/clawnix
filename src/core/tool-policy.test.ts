import { describe, it, expect } from "vitest";
import { ToolPolicy, evaluatePolicy } from "./tool-policy.js";

describe("ToolPolicy", () => {
  it("allows tools not mentioned in any policy", () => {
    const policies: ToolPolicy[] = [];
    expect(evaluatePolicy(policies, "clawnix_processes", "telegram", "user1")).toBe("allow");
  });

  it("blocks tools in deny list", () => {
    const policies: ToolPolicy[] = [
      { tool: "clawnix_query", effect: "deny", channels: ["telegram"] },
    ];
    expect(evaluatePolicy(policies, "clawnix_query", "telegram", "user1")).toBe("deny");
    expect(evaluatePolicy(policies, "clawnix_query", "webui", "user1")).toBe("allow");
  });

  it("requires approval for tools marked as such", () => {
    const policies: ToolPolicy[] = [
      { tool: "clawnix_query", effect: "approve", channels: ["telegram"] },
    ];
    expect(evaluatePolicy(policies, "clawnix_query", "telegram", "user1")).toBe("approve");
  });

  it("supports wildcard tool matching", () => {
    const policies: ToolPolicy[] = [
      { tool: "*", effect: "deny", channels: ["telegram"], users: ["unknown-user"] },
    ];
    expect(evaluatePolicy(policies, "clawnix_anything", "telegram", "unknown-user")).toBe("deny");
    expect(evaluatePolicy(policies, "clawnix_anything", "telegram", "owner")).toBe("allow");
  });

  it("first matching policy wins", () => {
    const policies: ToolPolicy[] = [
      { tool: "clawnix_query", effect: "allow", users: ["owner"] },
      { tool: "clawnix_query", effect: "deny" },
    ];
    expect(evaluatePolicy(policies, "clawnix_query", "terminal", "owner")).toBe("allow");
    expect(evaluatePolicy(policies, "clawnix_query", "terminal", "someone-else")).toBe("deny");
  });
});
