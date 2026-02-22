import { describe, it, expect, vi } from "vitest";
import { TelegramChannel } from "./index.js";
import { EventBus } from "../../core/event-bus.js";

describe("TelegramChannel", () => {
  it("implements ClawNixPlugin interface", () => {
    const channel = new TelegramChannel();
    expect(channel.name).toBe("telegram");
    expect(channel.version).toBeDefined();
  });

  it("rejects messages from non-allowed users", () => {
    const channel = new TelegramChannel();
    const allowed = channel.isAllowedUser("12345", ["67890"]);
    expect(allowed).toBe(false);
  });

  it("accepts messages from allowed users", () => {
    const channel = new TelegramChannel();
    const allowed = channel.isAllowedUser("12345", ["12345", "67890"]);
    expect(allowed).toBe(true);
  });

  it("accepts all users when allowedUsers is empty", () => {
    const channel = new TelegramChannel();
    const allowed = channel.isAllowedUser("12345", []);
    expect(allowed).toBe(true);
  });
});
