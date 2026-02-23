import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { MemoryPlugin } from "./index.js";
import { EventBus } from "../../core/event-bus.js";
import { StateStore } from "../../core/state.js";
import { PluginHost } from "../../core/plugin-host.js";
import { existsSync, readFileSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";

const TEST_DIR = "/tmp/clawnix-test-memory";
const WORKSPACE = join(TEST_DIR, "workspace");
const MEMORY_DIR = join(WORKSPACE, "memory");

describe("MemoryPlugin", () => {
  let eventBus: EventBus;
  let state: StateStore;
  let pluginHost: PluginHost;

  beforeEach(() => {
    mkdirSync(MEMORY_DIR, { recursive: true });
    eventBus = new EventBus();
    state = new StateStore(join(TEST_DIR, "test.db"));
    pluginHost = new PluginHost(eventBus, state);
  });

  afterEach(() => {
    state.close();
    rmSync(TEST_DIR, { recursive: true, force: true });
  });

  it("registers memory_read and memory_write tools", async () => {
    const plugin = new MemoryPlugin();
    await pluginHost.register(plugin, { workspaceDir: WORKSPACE });
    await pluginHost.initAll();
    const tools = pluginHost.getTools();
    const names = tools.map((t) => t.name);
    expect(names).toContain("clawnix_memory_read");
    expect(names).toContain("clawnix_memory_write");
  });

  it("reads MEMORY.md from workspace", async () => {
    writeFileSync(join(MEMORY_DIR, "MEMORY.md"), "# Agent Memory\nTest content");
    const plugin = new MemoryPlugin();
    await pluginHost.register(plugin, { workspaceDir: WORKSPACE });
    await pluginHost.initAll();
    const readTool = pluginHost.getTools().find((t) => t.name === "clawnix_memory_read");
    const result = await readTool!.run({});
    expect(result).toContain("Test content");
  });

  it("returns empty message when no MEMORY.md exists", async () => {
    // Remove the memory file if it exists
    const memFile = join(MEMORY_DIR, "MEMORY.md");
    if (existsSync(memFile)) rmSync(memFile);

    const plugin = new MemoryPlugin();
    await pluginHost.register(plugin, { workspaceDir: WORKSPACE });
    await pluginHost.initAll();
    const readTool = pluginHost.getTools().find((t) => t.name === "clawnix_memory_read");
    const result = await readTool!.run({});
    expect(result).toContain("empty");
  });

  it("writes to MEMORY.md in workspace", async () => {
    const plugin = new MemoryPlugin();
    await pluginHost.register(plugin, { workspaceDir: WORKSPACE });
    await pluginHost.initAll();
    const writeTool = pluginHost.getTools().find((t) => t.name === "clawnix_memory_write");
    await writeTool!.run({ content: "# Learned\nThe user prefers dark mode." });
    const content = readFileSync(join(MEMORY_DIR, "MEMORY.md"), "utf-8");
    expect(content).toContain("dark mode");
  });
});
