import { describe, it, expect, vi } from "vitest";
import { TerminalChannel } from "./index.js";
import type { PluginContext } from "../../core/types.js";
import { EventBus } from "../../core/event-bus.js";

describe("TerminalChannel", () => {
  it("implements NixClawPlugin interface", () => {
    const channel = new TerminalChannel();
    expect(channel.name).toBe("terminal");
    expect(channel.version).toBeDefined();
    expect(channel.init).toBeInstanceOf(Function);
    expect(channel.shutdown).toBeInstanceOf(Function);
  });

  it("emits message:incoming when receiving input", () => {
    const channel = new TerminalChannel();
    const bus = new EventBus();
    const incomingSpy = vi.fn();
    bus.on("message:incoming", incomingSpy);

    channel.processLine("hello world", bus);

    expect(incomingSpy).toHaveBeenCalledOnce();
    const msg = incomingSpy.mock.calls[0][0];
    expect(msg.channel).toBe("terminal");
    expect(msg.text).toBe("hello world");
  });
});
