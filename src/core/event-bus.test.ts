import { describe, it, expect, vi } from "vitest";
import { EventBus } from "./event-bus.js";

describe("EventBus", () => {
  it("delivers events to subscribers", () => {
    const bus = new EventBus();
    const handler = vi.fn();
    bus.on("test", handler);
    bus.emit("test", { data: "hello" });
    expect(handler).toHaveBeenCalledWith({ data: "hello" });
  });

  it("supports multiple subscribers", () => {
    const bus = new EventBus();
    const h1 = vi.fn();
    const h2 = vi.fn();
    bus.on("test", h1);
    bus.on("test", h2);
    bus.emit("test", "payload");
    expect(h1).toHaveBeenCalledWith("payload");
    expect(h2).toHaveBeenCalledWith("payload");
  });

  it("unsubscribes correctly", () => {
    const bus = new EventBus();
    const handler = vi.fn();
    const off = bus.on("test", handler);
    off();
    bus.emit("test", "payload");
    expect(handler).not.toHaveBeenCalled();
  });

  it("does not cross-deliver between event names", () => {
    const bus = new EventBus();
    const handler = vi.fn();
    bus.on("a", handler);
    bus.emit("b", "payload");
    expect(handler).not.toHaveBeenCalled();
  });
});
