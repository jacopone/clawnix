import { describe, it, expect, vi } from "vitest";
import { GooglePlugin } from "./index.js";
import { EventBus } from "../../core/event-bus.js";
import { StateStore } from "../../core/state.js";
import type { PluginContext, Tool } from "../../core/types.js";
import { unlinkSync } from "node:fs";

const TEST_DB = "/tmp/clawnix-google-test.db";

function makeCtx(
  config: Record<string, unknown> = {},
): { ctx: PluginContext; tools: Tool[]; state: StateStore } {
  const bus = new EventBus();
  const state = new StateStore(TEST_DB);
  const tools: Tool[] = [];
  const ctx: PluginContext = {
    eventBus: bus,
    registerTool: (t) => tools.push(t),
    state,
    config,
    logger: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    },
  };
  return { ctx, tools, state };
}

describe("GooglePlugin", () => {
  it("registers all google tools on init", async () => {
    const plugin = new GooglePlugin();
    const { ctx, tools, state } = makeCtx({});

    await plugin.init(ctx);

    const toolNames = tools.map((t) => t.name);
    expect(toolNames).toContain("clawnix_gmail_search");
    expect(toolNames).toContain("clawnix_gmail_read");
    expect(toolNames).toContain("clawnix_gmail_send");
    expect(toolNames).toContain("clawnix_gmail_draft");
    expect(toolNames).toContain("clawnix_calendar_list");
    expect(toolNames).toContain("clawnix_calendar_create");
    expect(toolNames).toContain("clawnix_calendar_freebusy");
    expect(toolNames).toContain("clawnix_drive_search");
    expect(tools).toHaveLength(8);

    state.close();
    try {
      unlinkSync(TEST_DB);
    } catch {}
  });

  it("uses custom gogcli binary path from config", async () => {
    const plugin = new GooglePlugin();
    const { ctx, tools, state } = makeCtx({
      gogcliBin: "/custom/path/gog",
      account: "me@example.com",
    });

    await plugin.init(ctx);

    // Just verify it registered tools — binary path is used at runtime
    expect(tools.length).toBeGreaterThan(0);

    state.close();
    try {
      unlinkSync(TEST_DB);
    } catch {}
  });

  it("gmail_search calls gog with correct arguments", async () => {
    const plugin = new GooglePlugin();
    const { ctx, tools, state } = makeCtx({
      gogcliBin: "echo",
    });

    await plugin.init(ctx);
    const searchTool = tools.find((t) => t.name === "clawnix_gmail_search")!;

    const result = await searchTool.run({
      query: "from:test is:unread",
      limit: 5,
    });
    // /bin/echo just echoes its args, so we can verify the command structure
    expect(result).toContain("gmail");
    expect(result).toContain("search");
    expect(result).toContain("from:test is:unread");
    expect(result).toContain("--max");
    expect(result).toContain("5");

    state.close();
    try {
      unlinkSync(TEST_DB);
    } catch {}
  });

  it("gmail_send includes --force flag", async () => {
    const plugin = new GooglePlugin();
    const { ctx, tools, state } = makeCtx({
      gogcliBin: "echo",
    });

    await plugin.init(ctx);
    const sendTool = tools.find((t) => t.name === "clawnix_gmail_send")!;

    const result = await sendTool.run({
      to: "user@example.com",
      subject: "Test",
      body: "Hello",
    });
    expect(result).toContain("--force");
    expect(result).toContain("--to");
    expect(result).toContain("user@example.com");

    state.close();
    try {
      unlinkSync(TEST_DB);
    } catch {}
  });

  it("calendar_list uses default 7 days", async () => {
    const plugin = new GooglePlugin();
    const { ctx, tools, state } = makeCtx({
      gogcliBin: "echo",
    });

    await plugin.init(ctx);
    const listTool = tools.find((t) => t.name === "clawnix_calendar_list")!;

    const result = await listTool.run({});
    expect(result).toContain("calendar");
    expect(result).toContain("events");
    expect(result).toContain("+7d");

    state.close();
    try {
      unlinkSync(TEST_DB);
    } catch {}
  });

  it("handles command errors gracefully", async () => {
    const plugin = new GooglePlugin();
    const { ctx, tools, state } = makeCtx({
      gogcliBin: "/nonexistent/binary",
    });

    await plugin.init(ctx);
    const searchTool = tools.find((t) => t.name === "clawnix_gmail_search")!;

    const result = await searchTool.run({ query: "test" });
    expect(result).toContain("Error:");

    state.close();
    try {
      unlinkSync(TEST_DB);
    } catch {}
  });

  it("passes account flag when configured", async () => {
    const plugin = new GooglePlugin();
    const { ctx, tools, state } = makeCtx({
      gogcliBin: "echo",
      account: "me@gmail.com",
    });

    await plugin.init(ctx);
    const searchTool = tools.find((t) => t.name === "clawnix_gmail_search")!;

    const result = await searchTool.run({ query: "test" });
    expect(result).toContain("--account");
    expect(result).toContain("me@gmail.com");

    state.close();
    try {
      unlinkSync(TEST_DB);
    } catch {}
  });
});
