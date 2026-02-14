import type { EventBus } from "./event-bus.js";
import type { StateStore } from "./state.js";
import type { NixClawPlugin, PluginContext, Tool, Logger } from "./types.js";

function createLogger(pluginName: string): Logger {
  const prefix = `[${pluginName}]`;
  return {
    info: (msg, ...args) => console.log(prefix, msg, ...args),
    warn: (msg, ...args) => console.warn(prefix, msg, ...args),
    error: (msg, ...args) => console.error(prefix, msg, ...args),
    debug: (msg, ...args) => console.debug(prefix, msg, ...args),
  };
}

interface RegisteredPlugin {
  plugin: NixClawPlugin;
  config: Record<string, unknown>;
}

export class PluginHost {
  private plugins: RegisteredPlugin[] = [];
  private tools: Tool[] = [];

  constructor(
    private eventBus: EventBus,
    private state: StateStore
  ) {}

  async register(
    plugin: NixClawPlugin,
    config: Record<string, unknown>
  ): Promise<void> {
    this.plugins.push({ plugin, config });
  }

  async initAll(): Promise<void> {
    for (const { plugin, config } of this.plugins) {
      const ctx: PluginContext = {
        eventBus: this.eventBus,
        registerTool: (tool: Tool) => this.tools.push(tool),
        state: this.state,
        config,
        logger: createLogger(plugin.name),
      };
      await plugin.init(ctx);
    }
  }

  async shutdownAll(): Promise<void> {
    for (const { plugin } of this.plugins.reverse()) {
      await plugin.shutdown();
    }
  }

  getTools(): Tool[] {
    return this.tools;
  }

  registerExternalTool(tool: Tool): void {
    this.tools.push(tool);
  }
}
