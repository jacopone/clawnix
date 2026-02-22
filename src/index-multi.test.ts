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

  it("handles prefix collisions", () => {
    const routes = buildAgentRoutes({
      support: {
        description: "email",
        ai: { provider: "claude", model: "m", apiKeyFile: "/dev/null" },
        tools: [], mcp: { servers: [] },
        workspaceDir: "/tmp/s1", toolPolicies: [],
      },
      search: {
        description: "web search",
        ai: { provider: "claude", model: "m", apiKeyFile: "/dev/null" },
        tools: [], mcp: { servers: [] },
        workspaceDir: "/tmp/s2", toolPolicies: [],
      },
    });
    // One gets 's', the other gets a different letter
    const prefixes = [routes.support.prefix, routes.search.prefix];
    expect(new Set(prefixes).size).toBe(2); // no collision
  });
});
