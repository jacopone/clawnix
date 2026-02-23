import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { DirectivesPlugin } from "./index.js";
import { EventBus } from "../../core/event-bus.js";
import { StateStore } from "../../core/state.js";
import { PluginHost } from "../../core/plugin-host.js";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import type { ClawNixMessage } from "../../core/types.js";

const TEST_DIR = "/tmp/clawnix-test-directives";

describe("DirectivesPlugin", () => {
  let eventBus: EventBus;
  let state: StateStore;
  let pluginHost: PluginHost;
  let plugin: DirectivesPlugin;

  beforeEach(() => {
    mkdirSync(TEST_DIR, { recursive: true });
    eventBus = new EventBus();
    state = new StateStore(join(TEST_DIR, "test.db"));
    pluginHost = new PluginHost(eventBus, state);
    plugin = new DirectivesPlugin();
  });

  afterEach(async () => {
    await pluginHost.shutdownAll();
    state.close();
    rmSync(TEST_DIR, { recursive: true, force: true });
  });

  it("registers directive tools (create, list, remove)", async () => {
    await pluginHost.register(plugin, {});
    await pluginHost.initAll();

    const names = pluginHost.getTools().map((t) => t.name);
    expect(names).toContain("clawnix_directive_create");
    expect(names).toContain("clawnix_directive_list");
    expect(names).toContain("clawnix_directive_remove");
  });

  it("creates and persists a directive", async () => {
    await pluginHost.register(plugin, {});
    await pluginHost.initAll();

    const createTool = pluginHost.getTools().find((t) => t.name === "clawnix_directive_create")!;
    const result = await createTool.run({
      trigger: "interval:30",
      action: "Check system health",
    });

    const parsed = JSON.parse(result);
    expect(parsed.status).toBe("created");
    expect(parsed.trigger).toBe("interval:30");
    expect(parsed.action).toBe("Check system health");
    expect(parsed.id).toBeDefined();

    // Verify persisted in state
    const stored = state.getJSON<Array<{ id: string; action: string }>>("directives", "all");
    expect(stored).toBeDefined();
    expect(stored!.length).toBe(1);
    expect(stored![0].action).toBe("Check system health");
  });

  it("lists directives", async () => {
    await pluginHost.register(plugin, {});
    await pluginHost.initAll();

    const createTool = pluginHost.getTools().find((t) => t.name === "clawnix_directive_create")!;
    await createTool.run({ trigger: "interval:15", action: "Run backup" });
    await createTool.run({ trigger: "cron:0 9 * * *", action: "Morning report" });

    const listTool = pluginHost.getTools().find((t) => t.name === "clawnix_directive_list")!;
    const result = await listTool.run({});

    expect(result).toContain("Run backup");
    expect(result).toContain("Morning report");
    expect(result).toContain("interval:15");
    expect(result).toContain("cron:0 9 * * *");
    expect(result).toContain("enabled");
  });

  it("removes a directive", async () => {
    await pluginHost.register(plugin, {});
    await pluginHost.initAll();

    const createTool = pluginHost.getTools().find((t) => t.name === "clawnix_directive_create")!;
    const createResult = await createTool.run({
      trigger: "interval:60",
      action: "Hourly check",
    });

    const { id } = JSON.parse(createResult);

    const removeTool = pluginHost.getTools().find((t) => t.name === "clawnix_directive_remove")!;
    const removeResult = await removeTool.run({ directiveId: id });

    const parsed = JSON.parse(removeResult);
    expect(parsed.status).toBe("removed");
    expect(parsed.id).toBe(id);

    // Verify removed from state
    const stored = state.getJSON<unknown[]>("directives", "all");
    expect(stored).toEqual([]);

    // Verify list is empty
    const listTool = pluginHost.getTools().find((t) => t.name === "clawnix_directive_list")!;
    const listResult = await listTool.run({});
    expect(listResult).toBe("No standing directives.");
  });

  it("fires interval-based directives via evaluateDirectives()", async () => {
    await pluginHost.register(plugin, {});
    await pluginHost.initAll();

    const createTool = pluginHost.getTools().find((t) => t.name === "clawnix_directive_create")!;
    await createTool.run({
      trigger: "interval:1",
      action: "Check disk usage",
    });

    const messages: ClawNixMessage[] = [];
    eventBus.on("message:incoming", (payload) => {
      messages.push(payload as ClawNixMessage);
    });

    // Call evaluateDirectives directly — interval:1 with no lastFiredAt should fire immediately
    plugin.evaluateDirectives();

    expect(messages.length).toBe(1);
    expect(messages[0].text).toContain("[Standing Directive");
    expect(messages[0].text).toContain("Check disk usage");
    expect(messages[0].channel).toBe("directive");
    expect(messages[0].sender).toBe("directive");
  });
});
