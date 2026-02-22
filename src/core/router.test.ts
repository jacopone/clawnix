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

  it("returns null for multi-char commands like /help", () => {
    const result = parseRoutePrefix("/help something");
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
    const mockClassify = vi.fn();
    const router = new Router({
      personal: { description: "calendar", prefix: "p" },
      devops: { description: "servers", prefix: "d" },
    });
    const result = await router.route("/d check nginx", { classify: mockClassify });
    expect(result.agent).toBe("devops");
    expect(result.message).toBe("check nginx");
    expect(result.method).toBe("prefix");
    expect(mockClassify).not.toHaveBeenCalled();
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

  it("returns ambiguous when classifier is unsure", async () => {
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
    const mockClassify = vi.fn();
    const router = new Router({
      personal: { description: "everything", prefix: "p" },
    });
    const result = await router.route("do anything", { classify: mockClassify });
    expect(result.agent).toBe("personal");
    expect(result.method).toBe("single");
    expect(mockClassify).not.toHaveBeenCalled();
  });

  it("returns ambiguous for unknown classification result", async () => {
    const mockClassify = vi.fn().mockResolvedValue("nonexistent-agent");
    const router = new Router({
      personal: { description: "calendar", prefix: "p" },
      devops: { description: "servers", prefix: "d" },
    });
    const result = await router.route("something weird", { classify: mockClassify });
    expect(result.agent).toBeNull();
    expect(result.method).toBe("ambiguous");
  });
});
