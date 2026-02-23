import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { SchedulerPlugin } from "./index.js";
import { EventBus } from "../../core/event-bus.js";
import { StateStore } from "../../core/state.js";
import { PluginHost } from "../../core/plugin-host.js";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";

const TEST_DIR = "/tmp/clawnix-test-scheduler";

describe("SchedulerPlugin", () => {
  let eventBus: EventBus;
  let state: StateStore;
  let pluginHost: PluginHost;

  beforeEach(() => {
    mkdirSync(TEST_DIR, { recursive: true });
    eventBus = new EventBus();
    state = new StateStore(join(TEST_DIR, "test.db"));
    pluginHost = new PluginHost(eventBus, state);
  });

  afterEach(() => {
    state.close();
    rmSync(TEST_DIR, { recursive: true, force: true });
  });

  it("implements ClawNixPlugin interface", () => {
    const plugin = new SchedulerPlugin();
    expect(plugin.name).toBe("scheduler");
    expect(plugin.version).toBe("0.2.0");
  });

  it("registers schedule, list, and remove tools on init", async () => {
    const plugin = new SchedulerPlugin();
    await pluginHost.register(plugin, {});
    await pluginHost.initAll();

    const names = pluginHost.getTools().map((t) => t.name);
    expect(names).toContain("clawnix_schedule_task");
    expect(names).toContain("clawnix_list_scheduled");
    expect(names).toContain("clawnix_remove_scheduled");

    await pluginHost.shutdownAll();
  });

  it("persists tasks to StateStore", async () => {
    const plugin = new SchedulerPlugin();
    await pluginHost.register(plugin, {});
    await pluginHost.initAll();

    const scheduleTool = pluginHost
      .getTools()
      .find((t) => t.name === "clawnix_schedule_task")!;
    await scheduleTool.run({
      cronExpression: "0 9 * * *",
      message: "daily check",
    });

    const stored = state.getJSON<Array<{ id: string; message: string }>>(
      "scheduler",
      "tasks"
    );
    expect(stored).toBeDefined();
    expect(stored!.length).toBe(1);
    expect(stored![0].message).toBe("daily check");
    expect(stored![0].cronExpression).toBe("0 9 * * *");

    await pluginHost.shutdownAll();
  });

  it("restores tasks on init", async () => {
    // Pre-populate state with a stored task
    state.setJSON("scheduler", "tasks", [
      {
        id: "abc123",
        cronExpression: "0 12 * * *",
        message: "noon reminder",
        channel: "scheduler",
      },
    ]);

    const plugin = new SchedulerPlugin();
    await pluginHost.register(plugin, {});
    await pluginHost.initAll();

    const listTool = pluginHost
      .getTools()
      .find((t) => t.name === "clawnix_list_scheduled")!;
    const result = await listTool.run({});

    expect(result).toContain("abc123");
    expect(result).toContain("noon reminder");
    expect(result).toContain("0 12 * * *");

    await pluginHost.shutdownAll();
  });

  it("warns on invalid cron expression during restore", async () => {
    // Pre-populate with an invalid cron expression
    state.setJSON("scheduler", "tasks", [
      {
        id: "bad1",
        cronExpression: "not-a-cron",
        message: "broken task",
        channel: "scheduler",
      },
    ]);

    const plugin = new SchedulerPlugin();
    await pluginHost.register(plugin, {});
    // Should not throw
    await pluginHost.initAll();

    const listTool = pluginHost
      .getTools()
      .find((t) => t.name === "clawnix_list_scheduled")!;
    const result = await listTool.run({});

    // The invalid task should not be in the running list
    expect(result).not.toContain("bad1");

    await pluginHost.shutdownAll();
  });

  it("remove tool removes a task", async () => {
    const plugin = new SchedulerPlugin();
    await pluginHost.register(plugin, {});
    await pluginHost.initAll();

    const scheduleTool = pluginHost
      .getTools()
      .find((t) => t.name === "clawnix_schedule_task")!;
    const scheduleResult = await scheduleTool.run({
      cronExpression: "0 8 * * *",
      message: "morning check",
    });

    // Extract the task ID from the result
    const match = scheduleResult.match(/^Scheduled task (\w+):/);
    expect(match).toBeTruthy();
    const taskId = match![1];

    const removeTool = pluginHost
      .getTools()
      .find((t) => t.name === "clawnix_remove_scheduled")!;
    const removeResult = await removeTool.run({ taskId });
    expect(removeResult).toContain("Removed");
    expect(removeResult).toContain(taskId);

    // Verify task is gone from list
    const listTool = pluginHost
      .getTools()
      .find((t) => t.name === "clawnix_list_scheduled")!;
    const listResult = await listTool.run({});
    expect(listResult).toBe("No scheduled tasks.");

    // Verify persisted state is updated
    const stored = state.getJSON<unknown[]>("scheduler", "tasks");
    expect(stored).toEqual([]);

    await pluginHost.shutdownAll();
  });

  it("remove tool returns error for unknown task ID", async () => {
    const plugin = new SchedulerPlugin();
    await pluginHost.register(plugin, {});
    await pluginHost.initAll();

    const removeTool = pluginHost
      .getTools()
      .find((t) => t.name === "clawnix_remove_scheduled")!;
    const result = await removeTool.run({ taskId: "nonexistent" });
    expect(result).toContain("No scheduled task found");

    await pluginHost.shutdownAll();
  });
});
