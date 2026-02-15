import { describe, it, expect, vi, afterEach } from "vitest";
import { HeartbeatPlugin } from "./index.js";
import { EventBus } from "../../core/event-bus.js";
import { StateStore } from "../../core/state.js";
import type { PluginContext, NixClawMessage } from "../../core/types.js";
import { mkdirSync, writeFileSync, rmSync, unlinkSync } from "node:fs";

const TEST_DIR = "/tmp/nixclaw-heartbeat-test";
const TEST_DB = "/tmp/nixclaw-heartbeat-test.db";

describe("HeartbeatPlugin", () => {
  afterEach(() => {
    try { rmSync(TEST_DIR, { recursive: true, force: true }); } catch {}
    try { unlinkSync(TEST_DB); } catch {}
  });

  it("reads HEARTBEAT.md and emits tasks as messages", async () => {
    mkdirSync(TEST_DIR, { recursive: true });
    writeFileSync(`${TEST_DIR}/HEARTBEAT.md`, "Check system status and report any anomalies.");

    const bus = new EventBus();
    const state = new StateStore(TEST_DB);
    const messages: unknown[] = [];
    bus.on("message:incoming", (msg) => messages.push(msg));

    const plugin = new HeartbeatPlugin();
    const ctx: PluginContext = {
      eventBus: bus,
      registerTool: vi.fn(),
      state,
      config: { workspaceDir: TEST_DIR, intervalMinutes: 0 },
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    };

    await plugin.init(ctx);
    plugin.tick();

    expect(messages).toHaveLength(1);
    const msg = messages[0] as NixClawMessage;
    expect(msg.channel).toBe("heartbeat");
    expect(msg.text).toContain("Check system status");

    state.close();
    await plugin.shutdown();
  });

  it("does nothing when HEARTBEAT.md is absent", async () => {
    mkdirSync(TEST_DIR, { recursive: true });

    const bus = new EventBus();
    const state = new StateStore(TEST_DB);
    const messages: unknown[] = [];
    bus.on("message:incoming", (msg) => messages.push(msg));

    const plugin = new HeartbeatPlugin();
    const ctx: PluginContext = {
      eventBus: bus,
      registerTool: vi.fn(),
      state,
      config: { workspaceDir: TEST_DIR, intervalMinutes: 0 },
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    };

    await plugin.init(ctx);
    plugin.tick();

    expect(messages).toHaveLength(0);

    state.close();
    await plugin.shutdown();
  });
});
