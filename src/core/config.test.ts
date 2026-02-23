import { describe, it, expect, afterEach } from "vitest";
import { loadConfig } from "./config.js";

describe("Config", () => {
  afterEach(() => {
    delete process.env.CLAWNIX_CONFIG;
  });

  it("loads config from CLAWNIX_CONFIG env var", () => {
    process.env.CLAWNIX_CONFIG = JSON.stringify({
      ai: { provider: "claude", model: "claude-opus-4-20250514", apiKeyFile: "/tmp/key" },
    });
    const cfg = loadConfig();
    expect(cfg.ai.model).toBe("claude-opus-4-20250514");
    expect(cfg.ai.apiKeyFile).toBe("/tmp/key");
  });

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
  });

  it("falls back to defaults when env var is not set", () => {
    const cfg = loadConfig();
    expect(cfg.ai.provider).toBe("claude");
    expect(cfg.ai.model).toBe("claude-sonnet-4-6");
    expect(cfg.channels.telegram.enable).toBe(false);
    expect(cfg.channels.webui.port).toBe(3333);
    expect(cfg.stateDir).toContain(".local/share/clawnix");
  });
});
